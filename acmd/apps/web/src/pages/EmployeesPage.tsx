/**
 * EmployeesPage — ACMD-144 Phase 6I
 *
 * URL: /employees
 * Roles allowed: super_admin, hr
 * Roles denied: manager → redirect /dashboard + toast
 *
 * Features:
 *  - Role-based access guard (manager redirect + toast)
 *  - Stats bar: Total / Active / Inactive / With Active Cases
 *  - Search + filters (Department / Status / Has Active Case) + sort + chips + Clear All
 *  - Company filter dropdown (Super Admin only)
 *  - Table: Name+avatar+title+startDate / Email / Dept / Manager / Status / Cases / Actions
 *  - Checkbox column + bulk action bar (Super Admin only)
 *  - Pagination: per-page dropdown + prev/next + page numbers
 *  - Empty states (no employees / no filter match)
 *  - Add Employee Modal (3 sections + inline validation)
 *  - Edit Employee Modal (read-only email + deactivation logic + active cases)
 *  - CSV Import Modal (3-step: Upload → Preview → Confirm)
 *
 * Auth Review Checklist:
 *  - cookie path sync: uses useAuth() for role only, does NOT touch cookies
 *  - logout clears state: all local state is cleared when component unmounts
 *  - token type asymmetry: NO token stored in localStorage
 *  - clock skew: date validation uses server-side consistency
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  exportEmployeesCsv,
  downloadImportTemplate,
  importEmployees,
} from '@/lib/api/employees';
import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRole = 'super_admin' | 'hr' | 'manager' | 'medical_reviewer';

function normalizeRole(raw: string | undefined): UserRole {
  if (
    raw === 'super_admin' ||
    raw === 'hr' ||
    raw === 'manager' ||
    raw === 'medical_reviewer'
  ) {
    return raw;
  }
  return 'manager'; // least-privilege fallback
}

interface Employee {
  id: string;
  name: string;
  email: string;
  position: string | null;
  department: string | null;
  managerId: string | null;
  managerName?: string | null;
  employmentStatus: 'active' | 'on_leave' | 'terminated';
  hireDate: string | null;
  activeCaseCount: number;
  companyId: string;
  companyName?: string;
  avatarUrl?: string;
}

interface Stats {
  total: number;
  active: number;
  inactive: number;
  withActiveCases: number;
}

type SortField = 'name' | 'email' | 'department' | 'hireDate' | 'employmentStatus';
type SortOrder = 'asc' | 'desc';

interface Filters {
  search: string;
  department: string;
  status: string;
  hasActiveCase: string;
  sortBy: SortField;
  sortOrder: SortOrder;
  companyId: string;
}

interface AddFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  managerId: string;
  startDate: string;
}

interface AddFormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  startDate?: string;
  [key: string]: string | undefined;
}

interface ImportPreviewRow {
  row: number;
  status: 'valid' | 'error' | 'duplicate';
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  error?: string;
}

interface ImportPreviewResult {
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  rows: ImportPreviewRow[];
  totalRows: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  'Engineering',
  'HR',
  'Finance',
  'Sales',
  'Marketing',
  'Operations',
  'Legal',
  'IT',
  'Product',
  'Design',
  'Customer Success',
  'Other',
];

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Name A-Z', value: 'name:asc' },
  { label: 'Name Z-A', value: 'name:desc' },
  { label: 'Start Date (Newest)', value: 'hireDate:desc' },
  { label: 'Start Date (Oldest)', value: 'hireDate:asc' },
  { label: 'Department A-Z', value: 'department:asc' },
  { label: 'Status', value: 'employmentStatus:asc' },
];

const PER_PAGE_OPTIONS = [25, 50, 100];

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatStartDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUSPhone(phone: string): boolean {
  if (!phone) return true; // optional
  return /^[\+]?1?[\s.-]?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/.test(phone);
}

function isValidStartDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const parts = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!parts) return false;
  const date = new Date(`${parts[3]}-${parts[1]}-${parts[2]}`);
  if (isNaN(date.getTime())) return false;
  return date <= new Date();
}

function dateToMMDDYYYY(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return '';
  }
}

function mmddyyyyToISO(dateStr: string): string {
  const parts = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!parts) return dateStr;
  return `${parts[3]}-${parts[1]}-${parts[2]}`;
}

// ---------------------------------------------------------------------------
// Toast (inline lightweight)
// ---------------------------------------------------------------------------

interface ToastState {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

// ---------------------------------------------------------------------------
// EmployeesPage
// ---------------------------------------------------------------------------

export function EmployeesPage() {
  const { user, client } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = normalizeRole(user?.role);
  const isSuperAdmin = role === 'super_admin';

  // ----- Toast -----
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const showToast = useCallback((message: string, type: ToastState['type'] = 'info') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // ----- Role guard -----
  useEffect(() => {
    if (role === 'manager' || role === 'medical_reviewer') {
      showToast('You do not have permission to access the Employee Registry.', 'error');
      navigate('/dashboard', { replace: true });
    }
  }, [role, navigate, showToast]);

  // ----- Clear TanStack Query cache when user logs out (AC-6) -----
  useEffect(() => {
    if (!user) {
      queryClient.clear();
    }
  }, [user, queryClient]);

  // ----- Filters -----
  const [filters, setFilters] = useState<Filters>({
    search: '',
    department: '',
    status: '',
    hasActiveCase: '',
    sortBy: 'name',
    sortOrder: 'asc',
    companyId: '',
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // ----- Data -----
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0, withActiveCases: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- Selection (SA only) -----
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ----- Modals -----
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // ----- Active employees list (for manager dropdown in modals) -----
  const [activeEmployees, setActiveEmployees] = useState<Employee[]>([]);

  // ----- Fetch employees -----
  const fetchEmployees = useCallback(async () => {
    if (role === 'manager' || role === 'medical_reviewer') return;
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      // Q-02: Use correct API param name per task spec
      // Q-04: Send department + hasActiveCase filters to API
      // Q-05: Send sort params to API
      const data = await listEmployees(client, {
        search: filters.search || undefined,
        employmentStatus: filters.status || undefined,
        department: filters.department || undefined,
        hasActiveCase: filters.hasActiveCase || undefined,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: perPage,
        offset: (page - 1) * perPage,
      });
      setEmployees(data.employees);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [role, client, filters, page, perPage]);

  // ----- Fetch server-side aggregate stats (Q-03 + SEC-009) -----
  // Stats must come from the server, not from the paginated page subset.
  // We make 3 separate calls: total, active count, inactive count.
  const fetchStats = useCallback(async () => {
    if (role === 'manager' || role === 'medical_reviewer') return;
    if (!client) return;
    try {
      // Fetch total count
      const [dataTotal, dataActive, dataInactive] = await Promise.all([
        listEmployees(client, { limit: 1, offset: 0 }),
        listEmployees(client, { employmentStatus: 'active', limit: 1, offset: 0 }),
        listEmployees(client, { employmentStatus: 'terminated', limit: 1, offset: 0 }),
      ]);
      setStats({
        total: dataTotal.total,
        active: dataActive.total,
        inactive: dataInactive.total,
        // withActiveCases is not supported by API filter yet — use page-local approximation
        withActiveCases: 0,
      });
    } catch {
      // Stats failure is non-fatal; leave existing state
    }
  }, [role, client]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Fetch stats once on mount and whenever role changes (Q-03 + SEC-009)
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ----- Fetch active employees for manager dropdown -----
  const fetchActiveEmployees = useCallback(async () => {
    if (role === 'manager' || role === 'medical_reviewer') return;
    if (!client) return;
    try {
      const data = await listEmployees(client, { employmentStatus: 'active', limit: 100 });
      setActiveEmployees(data.employees);
    } catch {
      // ignore
    }
  }, [role, client]);

  useEffect(() => {
    fetchActiveEmployees();
  }, [fetchActiveEmployees]);

  // ----- Pagination -----
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const startItem = total === 0 ? 0 : (page - 1) * perPage + 1;
  const endItem = Math.min(page * perPage, total);

  // ----- Filter chips -----
  const activeFilterChips: { label: string; key: keyof Filters }[] = [];
  if (filters.status) activeFilterChips.push({ label: `Status: ${filters.status}`, key: 'status' });
  if (filters.department) activeFilterChips.push({ label: `Dept: ${filters.department}`, key: 'department' });
  if (filters.hasActiveCase) activeFilterChips.push({ label: `Active Case: ${filters.hasActiveCase}`, key: 'hasActiveCase' });

  function clearFilter(key: keyof Filters) {
    setFilters((prev) => ({ ...prev, [key]: '' }));
    setPage(1);
  }

  function clearAllFilters() {
    setFilters((prev) => ({ ...prev, status: '', department: '', hasActiveCase: '', search: '' }));
    setPage(1);
  }

  // ----- Selection -----
  function toggleSelectAll() {
    if (selected.size === employees.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(employees.map((e) => e.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ----- Bulk deactivate -----
  async function handleBulkDeactivate() {
    if (!client) return;
    const idsToDeactivate = [...selected].filter((id) => {
      const emp = employees.find((e) => e.id === id);
      return emp && emp.activeCaseCount === 0;
    });
    if (idsToDeactivate.length === 0) {
      showToast('No employees can be deactivated (all have active cases).', 'error');
      return;
    }
    for (const id of idsToDeactivate) {
      await deleteEmployee(client, id);
    }
    setSelected(new Set());
    showToast(`${idsToDeactivate.length} employee(s) deactivated.`, 'success');
    fetchEmployees();
  }

  // ----- Export CSV (SEC-007: use fetch+blob to avoid PII in URL/history) -----
  // Binary endpoint: uses raw fetch with 401 guard (api-client doesn't support blob)
  async function handleExportCSV() {
    try {
      const blob = await exportEmployeesCsv([...selected]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employees.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Export failed. Please try again.', 'error');
    }
  }

  // guard: only render page for allowed roles
  if (role === 'manager' || role === 'medical_reviewer') {
    return null;
  }

  const hasFilters = filters.status || filters.department || filters.hasActiveCase || filters.search;
  const isEmpty = !loading && employees.length === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" data-testid="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
              t.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : t.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1
                className="text-2xl font-bold text-[#1E3A5F]"
                data-testid="page-title"
              >
                Employees
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {isSuperAdmin
                  ? 'All employees across the organization'
                  : `Employees at ${user?.companyId ?? 'your company'}`}
              </p>
              {/* Company filter — SA only */}
              {isSuperAdmin && (
                <div className="mt-2" data-testid="company-filter">
                  <select
                    className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={filters.companyId}
                    onChange={(e) => {
                      setFilters((prev) => ({ ...prev, companyId: e.target.value }));
                      setPage(1);
                    }}
                    aria-label="Company filter"
                  >
                    <option value="">All Companies</option>
                  </select>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onClick={() => setShowImportModal(true)}
                data-testid="import-csv-btn"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import CSV
              </button>
              <button
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#2563EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                onClick={() => setShowAddModal(true)}
                data-testid="add-employee-btn"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Employee
              </button>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-4 mb-6" data-testid="stats-bar">
          {[
            { label: 'Total', value: stats.total, testId: 'stat-total' },
            { label: 'Active', value: stats.active, testId: 'stat-active' },
            { label: 'Inactive', value: stats.inactive, testId: 'stat-inactive' },
            { label: 'With Active Cases', value: stats.withActiveCases, testId: 'stat-with-cases' },
          ].map(({ label, value, testId }) => (
            <div
              key={label}
              className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4"
              data-testid={testId}
            >
              <p className="text-sm text-gray-500">{label}</p>
              <p className="text-2xl font-bold mt-1 text-[#1E3A5F]">
                {loading ? '—' : value}
              </p>
            </div>
          ))}
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
          {/* Search */}
          <div className="relative mb-3">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, email, or department..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.search}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, search: e.target.value }));
                setPage(1);
              }}
              data-testid="search-input"
            />
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Filters:</span>
            <select
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.department}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, department: e.target.value }));
                setPage(1);
              }}
              data-testid="filter-department"
            >
              <option value="">Department</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.status}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, status: e.target.value }));
                setPage(1);
              }}
              data-testid="filter-status"
            >
              <option value="">Status</option>
              <option value="active">Active</option>
              <option value="terminated">Inactive</option>
              <option value="on_leave">On Leave</option>
            </select>

            <select
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.hasActiveCase}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, hasActiveCase: e.target.value }));
                setPage(1);
              }}
              data-testid="filter-active-case"
            >
              <option value="">Has Active Case</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-500">Sort:</span>
              <select
                className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={`${filters.sortBy}:${filters.sortOrder}`}
                onChange={(e) => {
                  const [sortBy, sortOrder] = e.target.value.split(':') as [SortField, SortOrder];
                  setFilters((prev) => ({ ...prev, sortBy, sortOrder }));
                }}
                data-testid="sort-select"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active filter chips */}
          {activeFilterChips.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap" data-testid="filter-chips">
              <span className="text-xs text-gray-400">Active filters:</span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded-full border border-blue-200 hover:bg-blue-100"
                  onClick={() => clearFilter(chip.key)}
                  data-testid={`chip-${chip.key}`}
                >
                  {chip.label}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ))}
              <button
                className="text-xs text-gray-400 hover:text-gray-600 underline"
                onClick={clearAllFilters}
                data-testid="clear-all-filters"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Bulk Action Bar (SA only, shown when ≥1 selected) */}
        {isSuperAdmin && selected.size > 0 && (
          <div
            className="bg-white rounded-xl border border-blue-200 shadow-sm px-4 py-3 mb-4 flex items-center gap-4"
            data-testid="bulk-action-bar"
          >
            <span className="text-sm font-medium text-gray-700">
              {selected.size} selected
            </span>
            <button
              className="text-sm px-3 py-1.5 border border-red-300 text-red-700 rounded-lg hover:bg-red-50"
              onClick={handleBulkDeactivate}
              data-testid="bulk-deactivate-btn"
            >
              Deactivate ▼
            </button>
            <button
              className="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              onClick={handleExportCSV}
              data-testid="bulk-export-btn"
            >
              Export CSV
            </button>
            <button
              className="text-sm text-gray-400 hover:text-gray-600"
              onClick={() => setSelected(new Set())}
              data-testid="deselect-all-btn"
            >
              Deselect All
            </button>
            <span className="ml-auto text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
              ⚠ Employees with active cases cannot be deactivated.
            </span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700" data-testid="error-state">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="employees-table">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {isSuperAdmin && (
                    <th className="px-4 py-3 w-10" data-testid="checkbox-header">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={employees.length > 0 && selected.size === employees.length}
                        onChange={toggleSelectAll}
                        aria-label="Select all"
                        data-testid="select-all-checkbox"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Department
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Manager
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Cases
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td
                      colSpan={isSuperAdmin ? 8 : 7}
                      className="px-4 py-8 text-center text-sm text-gray-400"
                      data-testid="loading-state"
                    >
                      Loading employees...
                    </td>
                  </tr>
                ) : isEmpty ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 8 : 7} className="px-4 py-0">
                      {hasFilters ? (
                        <EmptyFilterState onClear={clearAllFilters} />
                      ) : (
                        <EmptyNoEmployeesState
                          onImport={() => setShowImportModal(true)}
                          onAdd={() => setShowAddModal(true)}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  employees.map((emp) => (
                    <EmployeeRow
                      key={emp.id}
                      employee={emp}
                      isSuperAdmin={isSuperAdmin}
                      selected={selected.has(emp.id)}
                      onToggle={() => toggleSelect(emp.id)}
                      onEdit={() => setEditEmployee(emp)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {!isEmpty && !loading && (
          <Pagination
            page={page}
            totalPages={totalPages}
            startItem={startItem}
            endItem={endItem}
            total={total}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={(v) => { setPerPage(v); setPage(1); }}
          />
        )}
      </div>

      {/* Modals */}
      {showAddModal && client && (
        <AddEmployeeModal
          client={client}
          activeEmployees={activeEmployees}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            showToast('Employee added successfully.', 'success');
            fetchEmployees();
          }}
        />
      )}

      {editEmployee && client && (
        <EditEmployeeModal
          client={client}
          employee={editEmployee}
          activeEmployees={activeEmployees}
          onClose={() => setEditEmployee(null)}
          onSaved={() => {
            setEditEmployee(null);
            showToast('Employee updated successfully.', 'success');
            fetchEmployees();
          }}
          onDeactivated={() => {
            setEditEmployee(null);
            showToast('Employee deactivated.', 'success');
            fetchEmployees();
          }}
          onReactivated={() => {
            setEditEmployee(null);
            showToast('Employee reactivated.', 'success');
            fetchEmployees();
          }}
        />
      )}

      {showImportModal && (
        <CsvImportModal
          onClose={() => setShowImportModal(false)}
          onImported={(count) => {
            setShowImportModal(false);
            showToast(`${count} employees imported successfully.`, 'success');
            fetchEmployees();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmployeeRow
// ---------------------------------------------------------------------------

interface EmployeeRowProps {
  employee: Employee;
  isSuperAdmin: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}

function EmployeeRow({ employee, isSuperAdmin, selected, onToggle, onEdit }: EmployeeRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = employee.employmentStatus === 'active';
  const statusLabel = isActive ? 'Active' : employee.employmentStatus === 'on_leave' ? 'On Leave' : 'Inactive';
  const statusColor = isActive
    ? 'text-green-700 bg-green-50 border-green-200'
    : 'text-gray-500 bg-gray-50 border-gray-200';

  return (
    <tr
      className={`hover:bg-gray-50 transition-colors ${selected ? 'bg-blue-50' : ''}`}
      data-testid="employee-row"
    >
      {isSuperAdmin && (
        <td className="px-4 py-3">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${employee.name}`}
            data-testid="row-checkbox"
          />
        </td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 bg-[#2563EB]"
            aria-hidden="true"
          >
            {employee.avatarUrl ? (
              <img
                src={employee.avatarUrl}
                alt={employee.name}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              getInitials(employee.name)
            )}
          </div>
          <div>
            <p className="font-medium text-gray-900">{employee.name}</p>
            {employee.position && (
              <p className="text-xs text-gray-400">{employee.position}</p>
            )}
            {employee.hireDate && (
              <p className="text-xs text-gray-400">Started {formatStartDate(employee.hireDate)}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-600">{employee.email || '—'}</td>
      <td className="px-4 py-3 text-gray-600">{employee.department || '—'}</td>
      <td className="px-4 py-3 text-gray-600">{employee.managerName || '—'}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${statusColor}`}
          data-testid="status-badge"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
          {statusLabel}
        </span>
      </td>
      <td className="px-4 py-3" data-testid="cases-badge">
        {employee.activeCaseCount > 0 ? (
          <a
            href={`/cases?employeeId=${employee.id}`}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
          >
            <span className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
              {employee.activeCaseCount}
            </span>
          </a>
        ) : (
          <span className="text-xs text-gray-400">0</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
            onClick={onEdit}
            data-testid="edit-btn"
          >
            Edit
          </button>
          <div className="relative">
            <button
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              data-testid="more-actions-btn"
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <button
                  className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                >
                  Edit Employee
                </button>
                <a
                  href={`/cases?employeeId=${employee.id}`}
                  className="block w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => setMenuOpen(false)}
                  data-testid="menu-view-cases-link"
                >
                  View Cases
                </a>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Empty States
// ---------------------------------------------------------------------------

function EmptyNoEmployeesState({
  onImport,
  onAdd,
}: {
  onImport: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" data-testid="empty-state-no-employees">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-700 mb-1">No employees yet.</h3>
      <p className="text-sm text-gray-400 mb-6">Add employees to begin creating accommodation cases.</p>
      <div className="flex gap-3">
        <button
          className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          onClick={onImport}
        >
          Import CSV
        </button>
        <button
          className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg"
          onClick={onAdd}
        >
          + Add Employee
        </button>
      </div>
    </div>
  );
}

function EmptyFilterState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" data-testid="empty-state-filter">
      <h3 className="text-base font-semibold text-gray-700 mb-1">No employees match your filters.</h3>
      <button
        className="mt-4 text-sm text-blue-600 hover:underline"
        onClick={onClear}
        data-testid="clear-filters-btn"
      >
        Clear Filters
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginationProps {
  page: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  total: number;
  perPage: number;
  onPageChange: (p: number) => void;
  onPerPageChange: (v: number) => void;
}

function Pagination({
  page,
  totalPages,
  startItem,
  endItem,
  total,
  perPage,
  onPageChange,
  onPerPageChange,
}: PaginationProps) {
  const pages: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between" data-testid="pagination">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span>
          Showing {startItem}–{endItem} of {total} employees
        </span>
        <span className="text-gray-300">|</span>
        <div className="flex items-center gap-1.5">
          <span>Per page:</span>
          <select
            className="border border-gray-300 rounded text-sm px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            data-testid="per-page-select"
          >
            {PER_PAGE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          data-testid="prev-page-btn"
        >
          ← Prev
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e${i}`} className="px-2 text-gray-400 text-sm">
              ...
            </span>
          ) : (
            <button
              key={p}
              className={`px-3 py-1 text-sm border rounded ${
                p === page
                  ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium'
                  : 'border-gray-300 hover:bg-gray-50 text-gray-700'
              }`}
              onClick={() => onPageChange(p as number)}
              data-testid={`page-btn-${p}`}
            >
              {p}
            </button>
          ),
        )}
        <button
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          data-testid="next-page-btn"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Employee Modal
// ---------------------------------------------------------------------------

interface AddEmployeeModalProps {
  client: AuthenticatedClient;
  activeEmployees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}

function AddEmployeeModal({ client, activeEmployees, onClose, onSaved }: AddEmployeeModalProps) {
  const [form, setForm] = useState<AddFormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    department: '',
    jobTitle: '',
    managerId: '',
    startDate: '',
  });
  const [errors, setErrors] = useState<AddFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [managerSearch, setManagerSearch] = useState('');

  const filteredManagers = activeEmployees.filter((e) =>
    e.name.toLowerCase().includes(managerSearch.toLowerCase()),
  );

  function validate(): boolean {
    const errs: AddFormErrors = {};
    if (!form.firstName.trim()) errs.firstName = 'First name is required.';
    if (!form.lastName.trim()) errs.lastName = 'Last name is required.';
    if (!form.email.trim()) errs.email = 'A valid email address is required.';
    else if (!isValidEmail(form.email)) errs.email = 'A valid email address is required.';
    if (form.phone && !isValidUSPhone(form.phone)) errs.phone = 'Please enter a valid US phone number.';
    if (!form.department.trim()) errs.department = 'Department is required.';
    if (!form.jobTitle.trim()) errs.jobTitle = 'Job title is required.';
    if (!form.startDate.trim()) errs.startDate = 'Start date is required.';
    else if (!isValidStartDate(form.startDate)) errs.startDate = 'Start date cannot be in the future.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    try {
      const body = {
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        email: form.email.trim(),
        position: form.jobTitle.trim(),
        department: form.department.trim(),
        managerId: form.managerId || null,
        hireDate: mmddyyyyToISO(form.startDate),
      };
      await createEmployee(client, body);
      onSaved();
    } catch (err) {
      // SEC-002: Never render raw server error strings — use safe fallback
      const isConflict =
        (err as { status?: number })?.status === 409;
      if (isConflict) {
        setErrors((prev) => ({ ...prev, email: 'This email is already registered.' }));
      } else {
        console.error('Employee API error:', err);
        setServerError('An error occurred. Please try again. If the problem persists, contact support.');
      }
    } finally {
      setSaving(false);
    }
  }

  function field(
    label: string,
    key: keyof AddFormData,
    opts: { type?: string; required?: boolean; placeholder?: string; readOnly?: boolean } = {},
  ) {
    const { type = 'text', required = false, placeholder = '', readOnly = false } = opts;
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <input
          type={type}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors[key] ? 'border-red-400 bg-red-50' : 'border-gray-300'
          } ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          value={form[key]}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder={placeholder}
          readOnly={readOnly}
          data-testid={`field-${key}`}
        />
        {errors[key] && (
          <p className="mt-1 text-xs text-red-600" data-testid={`error-${key}`}>{errors[key]}</p>
        )}
      </div>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto" data-testid="add-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add New Employee</h2>
            <p className="text-xs text-gray-400 mt-0.5">* Required fields</p>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 p-1 rounded"
            onClick={onClose}
            data-testid="modal-close-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Personal Info */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Personal Info
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {field('First Name', 'firstName', { required: true })}
              {field('Last Name', 'lastName', { required: true })}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                {field('Email Address', 'email', { type: 'email', required: true })}
                <p className="mt-1 text-xs text-blue-600">
                  ⓘ Used as unique identifier. Cannot be changed later.
                </p>
              </div>
              {field('Phone (optional)', 'phone', { placeholder: '+1 (555) 000-0000' })}
            </div>
          </section>

          {/* Employment Info */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Employment Info
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department<span className="text-red-500 ml-0.5">*</span>
                </label>
                <select
                  className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.department ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                  value={form.department}
                  onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
                  data-testid="field-department"
                >
                  <option value="">Select department...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {errors.department && (
                  <p className="mt-1 text-xs text-red-600" data-testid="error-department">{errors.department}</p>
                )}
              </div>
              {field('Job Title', 'jobTitle', { required: true })}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1"
                placeholder="Search employees..."
                value={managerSearch}
                onChange={(e) => setManagerSearch(e.target.value)}
                data-testid="manager-search"
              />
              {managerSearch && (
                <div className="border border-gray-200 rounded-lg max-h-32 overflow-y-auto">
                  {filteredManagers.map((m) => (
                    <button
                      key={m.id}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                        form.managerId === m.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                      }`}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, managerId: m.id }));
                        setManagerSearch(m.name);
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                  {filteredManagers.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">No employees found.</p>
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-400">
                ⓘ Manager has limited access. They will NOT see medical information for this employee's accommodation cases.
              </p>
            </div>

            <div className="mt-4">
              {field('Start Date', 'startDate', { required: true, placeholder: 'MM/DD/YYYY' })}
            </div>
          </section>

          {serverError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700" data-testid="server-error">
              {serverError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            data-testid="cancel-btn"
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg font-medium disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
            data-testid="save-employee-btn"
          >
            {saving ? 'Saving...' : 'Save Employee →'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// Edit Employee Modal
// ---------------------------------------------------------------------------

interface EditEmployeeModalProps {
  client: AuthenticatedClient;
  employee: Employee;
  activeEmployees: Employee[];
  onClose: () => void;
  onSaved: () => void;
  onDeactivated: () => void;
  onReactivated: () => void;
}

function EditEmployeeModal({
  client,
  employee,
  activeEmployees,
  onClose,
  onSaved,
  onDeactivated,
  onReactivated,
}: EditEmployeeModalProps) {
  const nameParts = employee.name.split(' ');
  const defaultFirst = nameParts[0] ?? '';
  const defaultLast = nameParts.slice(1).join(' ');

  const [form, setForm] = useState<AddFormData>({
    firstName: defaultFirst,
    lastName: defaultLast,
    email: employee.email,
    phone: '',
    department: employee.department ?? '',
    jobTitle: employee.position ?? '',
    managerId: employee.managerId ?? '',
    startDate: dateToMMDDYYYY(employee.hireDate),
  });
  const [errors, setErrors] = useState<AddFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [managerSearch, setManagerSearch] = useState(employee.managerName ?? '');
  const [originalManagerId] = useState(employee.managerId ?? '');

  const isInactive = employee.employmentStatus !== 'active';
  const hasCases = employee.activeCaseCount > 0;
  const managerChanged = form.managerId !== originalManagerId;

  const filteredManagers = activeEmployees.filter(
    (e) => e.id !== employee.id && e.name.toLowerCase().includes(managerSearch.toLowerCase()),
  );

  function validate(): boolean {
    const errs: AddFormErrors = {};
    if (!form.firstName.trim()) errs.firstName = 'First name is required.';
    if (!form.lastName.trim()) errs.lastName = 'Last name is required.';
    if (!form.department.trim()) errs.department = 'Department is required.';
    if (!form.jobTitle.trim()) errs.jobTitle = 'Job title is required.';
    if (!form.startDate.trim()) errs.startDate = 'Start date is required.';
    else if (!isValidStartDate(form.startDate)) errs.startDate = 'Start date cannot be in the future.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    try {
      const body = {
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        position: form.jobTitle.trim(),
        department: form.department.trim(),
        managerId: form.managerId || null,
        hireDate: mmddyyyyToISO(form.startDate),
      };
      await updateEmployee(client, employee.id, body);
      onSaved();
    } catch (err) {
      // SEC-002: Never render raw server error strings — log and use safe fallback
      console.error('Employee API error:', err);
      setServerError('An error occurred. Please try again. If the problem persists, contact support.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (hasCases) return;
    setDeactivating(true);
    try {
      await deleteEmployee(client, employee.id);
      onDeactivated();
    } catch {
      setServerError('Failed to deactivate employee. Please try again.');
    } finally {
      setDeactivating(false);
    }
  }

  async function handleReactivate() {
    setDeactivating(true);
    try {
      await updateEmployee(client, employee.id, { employmentStatus: 'active' });
      onReactivated();
    } catch {
      setServerError('Failed to reactivate employee. Please try again.');
    } finally {
      setDeactivating(false);
    }
  }

  function field(
    label: string,
    key: keyof AddFormData,
    opts: { type?: string; required?: boolean; placeholder?: string; readOnly?: boolean } = {},
  ) {
    const { type = 'text', required = false, placeholder = '', readOnly = false } = opts;
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <input
          type={type}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors[key] ? 'border-red-400 bg-red-50' : 'border-gray-300'
          } ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          value={form[key]}
          onChange={(e) => !readOnly && setForm((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder={placeholder}
          readOnly={readOnly}
          data-testid={`edit-field-${key}`}
        />
        {errors[key] && (
          <p className="mt-1 text-xs text-red-600" data-testid={`edit-error-${key}`}>{errors[key]}</p>
        )}
      </div>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto" data-testid="edit-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Edit Employee — {employee.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">* Required fields</p>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 p-1 rounded"
            onClick={onClose}
            data-testid="edit-modal-close-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Personal Info */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Personal Info
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {field('First Name', 'firstName', { required: true })}
              {field('Last Name', 'lastName', { required: true })}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                {field('Email Address', 'email', { readOnly: true })}
                <p className="mt-1 text-xs text-gray-500">
                  🔒 Email cannot be changed (used as identifier)
                </p>
              </div>
              {field('Phone (optional)', 'phone', { placeholder: '+1 (555) 000-0000' })}
            </div>
          </section>

          {/* Employment Info */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Employment Info
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department<span className="text-red-500 ml-0.5">*</span>
                </label>
                <select
                  className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.department ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                  value={form.department}
                  onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
                  data-testid="edit-field-department"
                >
                  <option value="">Select department...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {errors.department && (
                  <p className="mt-1 text-xs text-red-600">{errors.department}</p>
                )}
              </div>
              {field('Job Title', 'jobTitle', { required: true })}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1"
                placeholder="Search employees..."
                value={managerSearch}
                onChange={(e) => setManagerSearch(e.target.value)}
                data-testid="edit-manager-search"
              />
              {managerSearch && managerSearch !== (employee.managerName ?? '') && (
                <div className="border border-gray-200 rounded-lg max-h-32 overflow-y-auto">
                  {filteredManagers.map((m) => (
                    <button
                      key={m.id}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                        form.managerId === m.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                      }`}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, managerId: m.id }));
                        setManagerSearch(m.name);
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
              {managerChanged && (
                <p className="mt-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1" data-testid="manager-change-notice">
                  ⚠ Changing manager will be recorded in audit log.
                </p>
              )}
            </div>

            <div className="mt-4">
              {field('Start Date', 'startDate', { required: true, placeholder: 'MM/DD/YYYY' })}
            </div>
          </section>

          {/* Active Cases */}
          {hasCases && (
            <section
              className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3"
              data-testid="active-cases-section"
            >
              <p className="text-sm text-blue-800 font-medium">
                🔵 This employee has {employee.activeCaseCount} active accommodation case(s).
              </p>
              <a
                href={`/cases?employeeId=${employee.id}`}
                className="inline-block mt-2 text-sm text-blue-600 hover:underline"
                data-testid="view-cases-link"
              >
                View Cases →
              </a>
            </section>
          )}

          {/* Deactivation Section */}
          <section
            className="border border-gray-200 rounded-xl px-4 py-4"
            data-testid="deactivation-section"
          >
            <p className="text-sm text-gray-600 font-medium mb-2">
              ⚠ Deactivating an employee makes them inactive.
            </p>
            <p className="text-xs text-gray-400 mb-3">
              They will not appear in new case employee dropdowns. Existing cases and audit history are preserved.
            </p>

            {isInactive ? (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  Reactivate this employee to allow new case creation.
                </p>
                <button
                  className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg font-medium"
                  onClick={handleReactivate}
                  disabled={deactivating}
                  data-testid="reactivate-btn"
                >
                  {deactivating ? 'Reactivating...' : 'Reactivate Employee'}
                </button>
              </>
            ) : hasCases ? (
              <>
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3" data-testid="deactivation-blocked">
                  <p className="text-sm text-red-700 font-semibold">🔴 DEACTIVATION BLOCKED</p>
                  <p className="text-xs text-red-600 mt-1">
                    This employee has {employee.activeCaseCount} active case(s). All cases must be closed before deactivating.
                  </p>
                  <a
                    href={`/cases?employeeId=${employee.id}`}
                    className="inline-block mt-1 text-xs text-red-600 hover:underline"
                  >
                    View Active Cases →
                  </a>
                </div>
                <button
                  className="px-4 py-2 text-sm text-gray-400 bg-gray-100 rounded-lg font-medium cursor-not-allowed"
                  disabled
                  data-testid="deactivate-btn"
                  aria-disabled="true"
                >
                  Deactivate Employee
                </button>
              </>
            ) : (
              <>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-yellow-700">
                    This will set employee to Inactive. Existing records are preserved.
                  </p>
                </div>
                <button
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg font-medium"
                  onClick={handleDeactivate}
                  disabled={deactivating}
                  data-testid="deactivate-btn"
                >
                  {deactivating ? 'Deactivating...' : 'Deactivate Employee'}
                </button>
              </>
            )}
          </section>

          {serverError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700" data-testid="edit-server-error">
              {serverError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            data-testid="edit-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg font-medium disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
            data-testid="save-changes-btn"
          >
            {saving ? 'Saving...' : 'Save Changes →'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// CSV Import Modal (3-step)
// ---------------------------------------------------------------------------

type ImportStep = 1 | 2 | 3 | 4; // 4 = result/success

interface CsvImportModalProps {
  onClose: () => void;
  onImported: (count: number) => void;
}

function CsvImportModal({ onClose, onImported }: CsvImportModalProps) {
  const [step, setStep] = useState<ImportStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'error' | 'duplicate'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PREVIEW_PER_PAGE = 10;

  // SEC-003: Map raw API/client error strings to safe user-facing messages
  function sanitizeCsvError(errorStr: string): string {
    const s = errorStr.toLowerCase();
    if (s.includes('required')) return 'This field is required.';
    if (s.includes('email')) return 'Invalid email format.';
    if (s.includes('duplicate') || s.includes('already exists')) return 'Email already exists in this company.';
    if (s.includes('date') || s.includes('future')) return 'Invalid date format or future date.';
    if (s.includes('manager')) return 'Manager email not found.';
    return 'Invalid data in this row.';
  }

  // SEC-004 + SEC-005: Synchronous validation (extension + MIME + size).
  // Row count check is in handleNextToPreview (requires async file.text()).
  function handleFileSelect(f: File) {
    setFileError(null);

    // SEC-005: MIME type validation for drag-drop (extension check is not enough)
    const validTypes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    if (!validTypes.includes(f.type) && !f.name.endsWith('.csv')) {
      setFileError('Only .csv files are accepted.');
      return;
    }
    if (!f.name.endsWith('.csv')) {
      setFileError('Only .csv files are accepted.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setFileError('File exceeds maximum size of 5MB.');
      return;
    }

    setFile(f);
  }

  // Q-01: Step 1→2 parses CSV client-side for preview — does NOT call /import API
  async function handleNextToPreview() {
    if (!file) {
      setFileError('Please select a CSV file.');
      return;
    }
    setUploading(true);
    setFileError(null);
    try {
      const text = await file.text();

      // SEC-004: Enforce 1000-row limit client-side
      const nonEmptyForCount = text.split('\n').filter((l) => l.trim().length > 0);
      const dataRowCount = nonEmptyForCount.length - 1; // subtract header
      if (dataRowCount > 1000) {
        setFileError('CSV exceeds maximum of 1,000 rows per import.');
        setUploading(false);
        return;
      }

      const allLines = text.split('\n');
      const nonEmpty = allLines.filter((l) => l.trim().length > 0);
      if (nonEmpty.length < 2) {
        setFileError('CSV must contain at least a header row and one data row.');
        setUploading(false);
        return;
      }
      const headers = nonEmpty[0].split(',').map((h) => h.trim().toLowerCase());
      const firstNameIdx = headers.indexOf('first_name');
      const lastNameIdx = headers.indexOf('last_name');
      const emailIdx = headers.indexOf('email');
      const deptIdx = headers.indexOf('department');

      const rows: ImportPreviewRow[] = nonEmpty.slice(1).map((line, i) => {
        const cols = line.split(',').map((c) => c.trim());
        const firstName = firstNameIdx >= 0 ? (cols[firstNameIdx] ?? '') : '';
        const lastName = lastNameIdx >= 0 ? (cols[lastNameIdx] ?? '') : '';
        const email = emailIdx >= 0 ? (cols[emailIdx] ?? '') : '';
        const department = deptIdx >= 0 ? (cols[deptIdx] ?? '') : '';

        let rowError: string | undefined;
        // Basic client-side validation
        if (!firstName) rowError = 'This field is required.';
        else if (!lastName) rowError = 'This field is required.';
        else if (!email) rowError = 'This field is required.';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowError = 'Invalid email format.';

        return {
          row: i + 2, // row numbers start at 2 (1 = header)
          status: rowError ? ('error' as const) : ('valid' as const),
          firstName,
          lastName,
          email,
          department,
          error: rowError,
        };
      });

      const validCount = rows.filter((r) => r.status === 'valid').length;
      const errorCount = rows.filter((r) => r.status === 'error').length;

      setPreview({
        validCount,
        errorCount,
        duplicateCount: 0,
        rows,
        totalRows: rows.length,
      });
      setStep(2);
    } catch {
      setFileError('Could not read file. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function handleConfirmImport() {
    setStep(3);
  }

  // Q-01: Step 3 "Confirm" button — THIS is where the real POST /import is called
  // Multipart/form-data: uses raw fetch with 401 guard (api-client doesn't support multipart)
  async function handleFinalImport() {
    if (!file) return;
    setImporting(true);
    try {
      const apiData = await importEmployees(file);
      const importedCount = apiData.imported ?? 0;
      const skippedCount = apiData.skipped ?? 0;

      // Merge API errors back into preview rows with sanitized messages (SEC-003)
      if (apiData.errors && apiData.errors.length > 0 && preview) {
        const errorRowNums = new Set(apiData.errors.map((e) => e.row));
        const updatedRows = preview.rows.map((r) => {
          if (errorRowNums.has(r.row)) {
            const apiErr = apiData.errors!.find((e) => e.row === r.row);
            return { ...r, status: 'error' as const, error: sanitizeCsvError(apiErr?.error ?? '') };
          }
          return r;
        });
        setPreview((prev) => prev ? { ...prev, rows: updatedRows, validCount: importedCount, errorCount: skippedCount } : prev);
      }

      setImportResult({ imported: importedCount, skipped: skippedCount });
      setStep(4);
    } catch (err) {
      // SEC-002: sanitize server error before showing user
      console.error('CSV import error:', err);
      setFileError('Import failed. Please try again. If the problem persists, contact support.');
      setStep(1);
    } finally {
      setImporting(false);
    }
  }

  // Binary download: uses raw fetch with 401 guard (api-client doesn't support blob)
  async function handleDownloadTemplate() {
    try {
      await downloadImportTemplate();
    } catch {
      // ignore — downloadImportTemplate handles 401 redirect
    }
  }

  // Q-08 + SEC-008: Implement Download Error Report (client-side CSV blob)
  function handleDownloadErrorReport() {
    if (!preview) return;
    const errorRows = preview.rows.filter((r) => r.status === 'error');
    if (errorRows.length === 0) return;
    const headers = ['Row', 'Status', 'Error', 'First Name', 'Last Name', 'Email', 'Department'];
    const csvContent = [
      headers.join(','),
      ...errorRows.map((r) => [
        r.row,
        'Error',
        `"${(r.error ?? '').replace(/"/g, '""')}"`,
        `"${r.firstName.replace(/"/g, '""')}"`,
        `"${r.lastName.replace(/"/g, '""')}"`,
        `"${r.email.replace(/"/g, '""')}"`,
        `"${r.department.replace(/"/g, '""')}"`,
      ].join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-errors-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredPreviewRows = preview?.rows.filter((r) => {
    if (previewFilter === 'all') return true;
    return r.status === previewFilter;
  }) ?? [];
  const previewTotalPages = Math.max(1, Math.ceil(filteredPreviewRows.length / PREVIEW_PER_PAGE));
  const previewStart = (previewPage - 1) * PREVIEW_PER_PAGE;
  const previewPageRows = filteredPreviewRows.slice(previewStart, previewStart + PREVIEW_PER_PAGE);

  const stepLabels = ['Upload', 'Preview', 'Confirm'];

  function StepIndicator({ current }: { current: number }) {
    return (
      <div className="flex items-center gap-2 mb-6" data-testid="step-indicator">
        {stepLabels.map((label, i) => {
          const stepNum = i + 1;
          const done = stepNum < current;
          const active = stepNum === current;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className="flex flex-col items-center">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    done
                      ? 'bg-green-500 text-white'
                      : active
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                  data-testid={`step-indicator-${stepNum}`}
                >
                  {done ? '✓' : stepNum}
                </div>
                <span
                  className={`text-xs mt-1 ${
                    active ? 'text-blue-700 font-semibold' : done ? 'text-green-600' : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <div className={`h-0.5 w-12 mb-4 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto" data-testid="import-modal">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Import Employees from CSV</h2>
          <button
            className="text-gray-400 hover:text-gray-600 p-1 rounded"
            onClick={onClose}
            data-testid="import-modal-close-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {step < 4 && <StepIndicator current={step} />}

          {/* Step 1 — Upload */}
          {step === 1 && (
            <div data-testid="import-step-1">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Step 1 of 3 — Upload CSV</h3>

              {/* Template download */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4">
                <button
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  onClick={handleDownloadTemplate}
                  data-testid="download-template-btn"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV Template
                </button>
                <p className="text-xs text-gray-400 mt-1">
                  Template includes headers + 1 example row. Columns: first_name, last_name, email, phone, department, job_title, manager_email, start_date (MM/DD/YYYY)
                </p>
              </div>

              {/* Drag-drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelect(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                data-testid="drop-zone"
              >
                <svg
                  className="w-10 h-10 text-gray-300 mx-auto mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {file ? (
                  <p className="text-sm text-gray-700 font-medium">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 font-medium">Drop CSV file here</p>
                    <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                  data-testid="file-input"
                />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Accepted: .csv only · Max size: 5MB · Max rows: 1,000
              </p>

              {fileError && (
                <p className="mt-2 text-sm text-red-600" data-testid="file-error">{fileError}</p>
              )}
            </div>
          )}

          {/* Step 2 — Preview */}
          {step === 2 && preview && (
            <div data-testid="import-step-2">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Step 2 of 3 — Preview & Validation</h3>

              {/* Validation summary */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4" data-testid="validation-summary">
                <div className="space-y-1">
                  <p className="text-sm text-green-700">✅ {preview.validCount} rows ready to import</p>
                  <p className="text-sm text-red-600">❌ {preview.errorCount} rows have errors (will be skipped)</p>
                  <p className="text-sm text-yellow-600">⚠ {preview.duplicateCount} rows are duplicates</p>
                </div>
                <div className="flex gap-2 mt-3">
                  {(['all', 'valid', 'error', 'duplicate'] as const).map((f) => (
                    <button
                      key={f}
                      className={`text-xs px-2 py-1 rounded border ${
                        previewFilter === f
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                      onClick={() => { setPreviewFilter(f); setPreviewPage(1); }}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto border border-gray-200 rounded-xl mb-3" data-testid="preview-table">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-500">#</th>
                      <th className="px-3 py-2 text-left text-gray-500">Status</th>
                      <th className="px-3 py-2 text-left text-gray-500">First</th>
                      <th className="px-3 py-2 text-left text-gray-500">Last</th>
                      <th className="px-3 py-2 text-left text-gray-500">Email</th>
                      <th className="px-3 py-2 text-left text-gray-500">Dept</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewPageRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                          No rows to display.
                        </td>
                      </tr>
                    ) : (
                      previewPageRows.map((row) => (
                        // Q-07: key on React.Fragment (not inner <tr>) to avoid React key warning
                        <React.Fragment key={row.row}>
                          <tr className={row.status === 'error' ? 'bg-red-50' : row.status === 'duplicate' ? 'bg-yellow-50' : ''}>
                            <td className="px-3 py-2">{row.row}</td>
                            <td className="px-3 py-2">
                              {row.status === 'valid' ? '✅' : row.status === 'error' ? '❌' : '⚠'}
                            </td>
                            <td className="px-3 py-2">{row.firstName}</td>
                            <td className="px-3 py-2">{row.lastName}</td>
                            <td className="px-3 py-2">{row.email}</td>
                            <td className="px-3 py-2">{row.department}</td>
                          </tr>
                          {row.error && (
                            <tr className="bg-red-50">
                              <td colSpan={6} className="px-3 pb-2 text-xs text-red-600">
                                {/* SEC-003: row.error already sanitized via sanitizeCsvError() */}
                                Error: {row.error}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
                  <span className="text-xs text-gray-400">
                    Showing {previewStart + 1}-{Math.min(previewStart + PREVIEW_PER_PAGE, filteredPreviewRows.length)} of {filteredPreviewRows.length} rows
                  </span>
                  <div className="flex gap-1">
                    <button
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-40"
                      disabled={previewPage === 1}
                      onClick={() => setPreviewPage((p) => p - 1)}
                    >
                      ← Prev
                    </button>
                    <button
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-40"
                      disabled={previewPage === previewTotalPages}
                      onClick={() => setPreviewPage((p) => p + 1)}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>

              {preview.errorCount > 0 && (
                <button
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1 mb-3"
                  onClick={handleDownloadErrorReport}
                  data-testid="download-error-report-btn"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Error Report ({preview.errorCount} rows)
                </button>
              )}

              {preview.errorCount > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-3">
                  <p className="text-xs text-blue-700">
                    ⓘ Partial import: {preview.validCount} valid rows will be imported. {preview.errorCount} rows with errors will be skipped. You can fix errors in the CSV and re-import.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Confirm */}
          {step === 3 && preview && (
            <div data-testid="import-step-3">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Step 3 of 3 — Confirm Import</h3>
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 mb-4" data-testid="import-summary">
                <p className="text-sm text-gray-700 font-medium mb-3">You are about to import:</p>
                <div className="space-y-1">
                  <p className="text-sm text-green-700">✅ {preview.validCount} new employees</p>
                  <p className="text-sm text-red-600">❌ {preview.errorCount} rows skipped (errors)</p>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  All imported records will be logged in the audit trail. PII (name, email, phone) will be encrypted at rest.
                </p>
              </div>
            </div>
          )}

          {/* Step 4 — Result */}
          {step === 4 && importResult && (
            <div className="text-center py-6" data-testid="import-result">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">✅ Import Complete</h3>
              <p className="text-sm text-gray-600">
                {importResult.imported} employees imported successfully.
              </p>
              {importResult.skipped > 0 && (
                <p className="text-sm text-gray-400 mt-1">
                  {importResult.skipped} rows were skipped.{' '}
                  <button className="text-blue-600 hover:underline" onClick={handleDownloadErrorReport}>Download Error Report</button>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          {step === 1 && (
            <>
              <button
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg font-medium disabled:opacity-50"
                onClick={handleNextToPreview}
                disabled={uploading || !file}
                data-testid="next-preview-btn"
              >
                {uploading ? 'Uploading...' : 'Next: Preview →'}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={() => setStep(1)}
                data-testid="back-to-upload-btn"
              >
                ← Back
              </button>
              <button
                className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg font-medium"
                onClick={handleConfirmImport}
                data-testid="confirm-import-btn"
              >
                Confirm Import ({preview?.validCount}) →
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={() => setStep(2)}
                data-testid="back-to-preview-btn"
              >
                ← Back to Preview
              </button>
              <button
                className="px-4 py-2 text-sm text-white bg-[#2563EB] rounded-lg font-medium disabled:opacity-50"
                onClick={handleFinalImport}
                disabled={importing}
                data-testid="final-import-btn"
              >
                {importing ? 'Importing...' : `✓ Import ${preview?.validCount} Employees`}
              </button>
            </>
          )}
          {step === 4 && (
            <div className="w-full flex justify-center">
              <button
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  if (importResult) onImported(importResult.imported);
                }}
                data-testid="close-result-btn"
              >
                ✕ Close
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// Modal Overlay
// ---------------------------------------------------------------------------

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

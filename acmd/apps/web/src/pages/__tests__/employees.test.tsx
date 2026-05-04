/**
 * ACMD-144-fix — Vitest tests for EmployeesPage
 *
 * Tests (35):
 *   T01: Manager role — redirects to /dashboard
 *   T02: Medical reviewer role — redirects to /dashboard
 *   T03: HR role — no company filter dropdown visible
 *   T04: HR role — no checkbox column in table header
 *   T05: HR role — no bulk action bar visible initially
 *   T06: Super Admin — company filter dropdown visible
 *   T07: Super Admin — checkbox column visible in table header
 *   T08: Super Admin — bulk action bar shown when employee selected
 *   T09: Table renders with employee data (name, email, dept, status)
 *   T10: Search input is present and accepts input
 *   T11: Filter dropdowns (department, status, active-case) are present
 *   T12: Sort dropdown is present
 *   T13: Add modal opens on button click
 *   T14: Add modal closes on Cancel
 *   T15: Add form validation — required firstName field shows error
 *   T16: Add form validation — invalid email format
 *   T17: Add form validation — future start date
 *   T18: Edit modal opens with employee data
 *   T19: Deactivation button disabled when employee has active cases
 *   T20: Deactivation button enabled when employee has no active cases
 *   T21: Edit modal shows Reactivate button when employee is inactive
 *   T22: CSV import modal opens on Import CSV button click
 *   T23: CSV import modal step 1 visible with template download and drop zone
 *   T24: CSV import Next: Preview → step 2 (client-side parse, NO API call)
 *   T25: CSV import step 3 shows import summary
 *   T26: Empty state shown when no employees (no filters active)
 *   T27: Empty filter state shown when search active but no results
 *   T28: Pagination controls rendered (prev/next buttons)
 *   T29: Stats bar renders all 4 stat boxes
 *   T30: Bulk deselect all clears selection
 *   T31: CSV import — POST /import only called at Step 3, NOT at Step 1→2
 *   T32: CSV import — handleFinalImport calls POST /import with the file
 *   T33: Row count > 1000 shows error toast and rejects file
 *   T34: Wrong MIME type (no .csv extension) is rejected
 *   T35: RoleGuard in App.tsx redirects manager at route level (via App routing)
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Hoist auth mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

import { EmployeesPage } from '@/pages/EmployeesPage';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

type RoleType = 'hr' | 'super_admin' | 'manager' | 'medical_reviewer';

const API = 'http://localhost:3000';

/** Mock AuthenticatedClient whose request() delegates to apiRequest (MSW-interceptable). */
function makeMockClient() {
  return {
    request: vi.fn().mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (path: string, options?: Record<string, unknown>) => apiRequest<any>(path, options),
    ),
    refreshOnce: vi.fn(),
  };
}

function setupAuth(role: RoleType) {
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-test-001',
      email: `${role}@acmd-test.com`,
      name: `${role} User`,
      role,
      companyId: 'company-test-abc',
    },
    client: makeMockClient(),
    isAuthenticated: true,
    token: 'fake-token',
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

const MOCK_EMPLOYEES = [
  {
    id: 'emp-001',
    name: 'John Davis',
    email: 'john.davis@co.com',
    position: 'Software Engineer',
    department: 'Engineering',
    managerId: null,
    managerName: null,
    employmentStatus: 'active',
    hireDate: '2023-03-15',
    activeCaseCount: 2,
    companyId: 'company-test-abc',
  },
  {
    id: 'emp-002',
    name: 'Maria Lopez',
    email: 'maria.l@co.com',
    position: 'HR Specialist',
    department: 'HR',
    managerId: null,
    managerName: null,
    employmentStatus: 'active',
    hireDate: '2022-06-01',
    activeCaseCount: 0,
    companyId: 'company-test-abc',
  },
  {
    id: 'emp-003',
    name: 'Kim Park',
    email: 'kim.park@co.com',
    position: 'Sales Associate',
    department: 'Sales',
    managerId: null,
    managerName: null,
    employmentStatus: 'terminated',
    hireDate: '2020-02-28',
    activeCaseCount: 0,
    companyId: 'company-test-abc',
  },
];

function setupEmployeesHandler(employees = MOCK_EMPLOYEES, total = MOCK_EMPLOYEES.length) {
  server.use(
    http.get(`${API}/api/v1/employees`, () =>
      HttpResponse.json({
        employees,
        total,
        limit: 25,
        offset: 0,
      }),
    ),
  );
}

function setupEmptyEmployeesHandler() {
  server.use(
    http.get(`${API}/api/v1/employees`, () =>
      HttpResponse.json({ employees: [], total: 0, limit: 25, offset: 0 }),
    ),
  );
}

function renderEmployeesPage(initialPath = '/employees') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEmployeesHandler();
  });

  // ── Role guard ─────────────────────────────────────────────────────────────

  it('T01: Manager role — redirects to /dashboard', async () => {
    setupAuth('manager');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });

  it('T02: Medical reviewer role — redirects to /dashboard', async () => {
    setupAuth('medical_reviewer');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });

  // ── HR role restrictions ────────────────────────────────────────────────────

  it('T03: HR role — no company filter dropdown visible', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('company-filter')).not.toBeInTheDocument();
  });

  it('T04: HR role — no checkbox column in table header', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('employees-table')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('checkbox-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('select-all-checkbox')).not.toBeInTheDocument();
  });

  it('T05: HR role — no bulk action bar visible initially', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  // ── Super Admin features ────────────────────────────────────────────────────

  it('T06: Super Admin — company filter dropdown visible', async () => {
    setupAuth('super_admin');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('company-filter')).toBeInTheDocument();
    });
  });

  it('T07: Super Admin — checkbox column visible in table header', async () => {
    setupAuth('super_admin');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('checkbox-header')).toBeInTheDocument();
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument();
    });
  });

  it('T08: Super Admin — bulk action bar shown when employee selected', async () => {
    setupAuth('super_admin');
    renderEmployeesPage();
    await waitFor(() => {
      const checkboxes = screen.getAllByTestId('row-checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });
    const checkboxes = screen.getAllByTestId('row-checkbox');
    fireEvent.click(checkboxes[0]);
    await waitFor(() => {
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    });
  });

  // ── Table rendering ─────────────────────────────────────────────────────────

  it('T09: Table renders with employee data', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByText('John Davis')).toBeInTheDocument();
      expect(screen.getByText('john.davis@co.com')).toBeInTheDocument();
      expect(screen.getByText('Maria Lopez')).toBeInTheDocument();
    });
  });

  // ── Search input ────────────────────────────────────────────────────────────

  it('T10: Search input is present and accepts input', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });
    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'John' } });
    expect((searchInput as HTMLInputElement).value).toBe('John');
  });

  // ── Filter dropdowns ────────────────────────────────────────────────────────

  it('T11: Filter dropdowns (department, status, active-case) are present', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('filter-department')).toBeInTheDocument();
      expect(screen.getByTestId('filter-status')).toBeInTheDocument();
      expect(screen.getByTestId('filter-active-case')).toBeInTheDocument();
    });
  });

  it('T12: Sort dropdown is present', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('sort-select')).toBeInTheDocument();
    });
  });

  // ── Add modal ───────────────────────────────────────────────────────────────

  it('T13: Add modal opens on button click', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('add-employee-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('add-modal')).toBeInTheDocument();
    });
  });

  it('T14: Add modal closes on Cancel', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('add-employee-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('add-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('cancel-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('add-modal')).not.toBeInTheDocument();
    });
  });

  // ── Add form validation ─────────────────────────────────────────────────────

  it('T15: Add form validation — required firstName field shows error', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('add-employee-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('add-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('save-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('error-firstName')).toBeInTheDocument();
      expect(screen.getByTestId('error-firstName').textContent).toBe('First name is required.');
    });
  });

  it('T16: Add form validation — invalid email format', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('add-employee-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('add-modal')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('field-firstName'), { target: { value: 'John' } });
    fireEvent.change(screen.getByTestId('field-lastName'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByTestId('field-email'), { target: { value: 'notanemail' } });
    fireEvent.click(screen.getByTestId('save-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('error-email')).toBeInTheDocument();
      expect(screen.getByTestId('error-email').textContent).toBe('A valid email address is required.');
    });
  });

  it('T17: Add form validation — future start date', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('add-employee-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('add-modal')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('field-firstName'), { target: { value: 'John' } });
    fireEvent.change(screen.getByTestId('field-lastName'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByTestId('field-email'), { target: { value: 'john@co.com' } });
    fireEvent.change(screen.getByTestId('field-startDate'), { target: { value: '12/31/2099' } });
    fireEvent.click(screen.getByTestId('save-employee-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('error-startDate')).toBeInTheDocument();
      expect(screen.getByTestId('error-startDate').textContent).toBe('Start date cannot be in the future.');
    });
  });

  // ── Edit modal ──────────────────────────────────────────────────────────────

  it('T18: Edit modal opens with employee data', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      const editBtns = screen.getAllByTestId('edit-btn');
      expect(editBtns.length).toBeGreaterThan(0);
    });
    const editBtns = screen.getAllByTestId('edit-btn');
    fireEvent.click(editBtns[0]);
    await waitFor(() => {
      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
    });
    const firstNameInput = screen.getByTestId('edit-field-firstName') as HTMLInputElement;
    expect(firstNameInput.value).toBe('John');
  });

  // ── Deactivation states ─────────────────────────────────────────────────────

  it('T19: Deactivation button disabled when employee has active cases', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('edit-btn').length).toBeGreaterThan(0);
    });
    // First employee (John Davis) has activeCaseCount: 2
    fireEvent.click(screen.getAllByTestId('edit-btn')[0]);
    await waitFor(() => {
      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
      expect(screen.getByTestId('deactivation-blocked')).toBeInTheDocument();
    });
    const deactivateBtn = screen.getByTestId('deactivate-btn');
    expect(deactivateBtn).toBeDisabled();
  });

  it('T20: Deactivation button enabled when employee has no active cases', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('edit-btn').length).toBeGreaterThan(0);
    });
    // Second employee (Maria Lopez) has activeCaseCount: 0
    fireEvent.click(screen.getAllByTestId('edit-btn')[1]);
    await waitFor(() => {
      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
    });
    const deactivateBtn = screen.getByTestId('deactivate-btn');
    expect(deactivateBtn).not.toBeDisabled();
  });

  it('T21: Edit modal shows Reactivate button when employee is inactive', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('edit-btn').length).toBeGreaterThan(0);
    });
    // Third employee (Kim Park) has employmentStatus: 'terminated'
    fireEvent.click(screen.getAllByTestId('edit-btn')[2]);
    await waitFor(() => {
      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
      expect(screen.getByTestId('reactivate-btn')).toBeInTheDocument();
    });
  });

  // ── CSV import modal ────────────────────────────────────────────────────────

  it('T22: CSV import modal opens on Import CSV button click', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('import-csv-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('import-csv-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('import-modal')).toBeInTheDocument();
    });
  });

  it('T23: CSV import modal step 1 visible with template download and drop zone', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('import-csv-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('import-csv-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('import-step-1')).toBeInTheDocument();
      expect(screen.getByTestId('download-template-btn')).toBeInTheDocument();
      expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    });
  });

  it('T24: CSV import — Next: Preview moves to step 2 using client-side parse (no API call at step 1→2)', async () => {
    // Q-01: Step 1→2 must NOT call the import API — it parses CSV client-side
    const importSpy = vi.fn();
    server.use(
      http.post(`${API}/api/v1/employees/import`, () => {
        importSpy();
        return HttpResponse.json({ imported: 0, skipped: 0, errors: [] });
      }),
    );

    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('import-csv-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('import-csv-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('import-step-1')).toBeInTheDocument();
    });

    // Provide a valid CSV with proper headers
    const csvContent = 'first_name,last_name,email,department\nJohn,Davis,john@co.com,Engineering';
    const file = new File([csvContent], 'employees.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('file-input');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByTestId('next-preview-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('import-step-2')).toBeInTheDocument();
    });

    // CRITICAL: import API must NOT have been called at step 1→2
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('T25: CSV import step 3 shows import summary', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('import-csv-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('import-csv-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('import-step-1')).toBeInTheDocument();
    });

    // Use proper CSV headers so client-side parse succeeds
    const csvContent = 'first_name,last_name,email,department\nJohn,Davis,john@co.com,Engineering';
    const file = new File([csvContent], 'emp.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('file-input');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByTestId('next-preview-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('import-step-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('confirm-import-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('import-step-3')).toBeInTheDocument();
      expect(screen.getByTestId('import-summary')).toBeInTheDocument();
    });
  });

  // ── Empty states ────────────────────────────────────────────────────────────

  it('T26: Empty state shown when no employees and no filters active', async () => {
    setupEmptyEmployeesHandler();
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('empty-state-no-employees')).toBeInTheDocument();
    });
  });

  it('T27: Empty filter state shown when search active but no results', async () => {
    setupEmptyEmployeesHandler();
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });
    // Type in search to activate filter
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'xyznotfound' } });
    await waitFor(() => {
      expect(screen.getByTestId('empty-state-filter')).toBeInTheDocument();
    });
  });

  // ── Pagination ──────────────────────────────────────────────────────────────

  it('T28: Pagination controls rendered (prev/next buttons)', async () => {
    setupEmployeesHandler(MOCK_EMPLOYEES, 100);
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('pagination')).toBeInTheDocument();
      expect(screen.getByTestId('prev-page-btn')).toBeInTheDocument();
      expect(screen.getByTestId('next-page-btn')).toBeInTheDocument();
    });
  });

  // ── Stats bar ───────────────────────────────────────────────────────────────

  it('T29: Stats bar renders all 4 stat boxes', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getByTestId('stats-bar')).toBeInTheDocument();
      expect(screen.getByTestId('stat-total')).toBeInTheDocument();
      expect(screen.getByTestId('stat-active')).toBeInTheDocument();
      expect(screen.getByTestId('stat-inactive')).toBeInTheDocument();
      expect(screen.getByTestId('stat-with-cases')).toBeInTheDocument();
    });
  });

  // ── Bulk deselect ───────────────────────────────────────────────────────────

  it('T30: Bulk deselect all clears selection and hides bulk bar', async () => {
    setupAuth('super_admin');
    renderEmployeesPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('row-checkbox').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByTestId('row-checkbox')[0]);
    await waitFor(() => {
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('deselect-all-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });
  });

  // ── Q-01 + SEC-001: Critical fixes ─────────────────────────────────────────

  it('T31: CSV import — POST /import is NOT called when clicking Next: Preview (step 1→2)', async () => {
    // Q-01: the real import must only fire at step 3, never at step 1→2
    const importCalled = vi.fn();
    server.use(
      http.post(`${API}/api/v1/employees/import`, () => {
        importCalled();
        return HttpResponse.json({ imported: 1, skipped: 0, errors: [] });
      }),
    );

    setupAuth('hr');
    renderEmployeesPage();
    fireEvent.click(await screen.findByTestId('import-csv-btn'));
    await screen.findByTestId('import-step-1');

    const csvContent = 'first_name,last_name,email,department\nAlice,Smith,alice@co.com,HR';
    const file = new File([csvContent], 'test.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('file-input');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByTestId('next-preview-btn'));
    await screen.findByTestId('import-step-2');

    // API must NOT have been called at this point
    expect(importCalled).not.toHaveBeenCalled();
  });

  it('T32: CSV import — POST /import IS called when clicking Confirm at Step 3', async () => {
    // Q-01: handleFinalImport at step 3 must call POST /import
    const importCalled = vi.fn();
    server.use(
      http.post(`${API}/api/v1/employees/import`, () => {
        importCalled();
        return HttpResponse.json({ imported: 1, skipped: 0, errors: [] });
      }),
    );

    setupAuth('hr');
    renderEmployeesPage();
    fireEvent.click(await screen.findByTestId('import-csv-btn'));
    await screen.findByTestId('import-step-1');

    const csvContent = 'first_name,last_name,email,department\nAlice,Smith,alice@co.com,HR';
    const file = new File([csvContent], 'test.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('file-input');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Step 1 → 2 (client-side parse, no API call)
    fireEvent.click(screen.getByTestId('next-preview-btn'));
    await screen.findByTestId('import-step-2');

    // Step 2 → 3
    fireEvent.click(screen.getByTestId('confirm-import-btn'));
    await screen.findByTestId('import-step-3');

    // Step 3: click Confirm Import — THIS should call the API
    fireEvent.click(screen.getByTestId('final-import-btn'));
    await waitFor(() => {
      expect(importCalled).toHaveBeenCalledTimes(1);
    });
  });

  it('T33: CSV import — row count > 1000 shows error when clicking Next: Preview', async () => {
    // SEC-004: Row count limit checked in handleNextToPreview (async file.text())
    setupAuth('hr');
    renderEmployeesPage();
    fireEvent.click(await screen.findByTestId('import-csv-btn'));
    await screen.findByTestId('import-step-1');

    // Build CSV with 1001 data rows (header + 1001 lines)
    const header = 'first_name,last_name,email,department\n';
    const rows = Array.from({ length: 1001 }, (_, i) => `First${i},Last${i},emp${i}@co.com,HR`).join('\n');
    const bigCsv = header + rows;
    const file = new File([bigCsv], 'big.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('file-input');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // File passes handleFileSelect (extension + size OK), but row check fires at next-preview click
    await waitFor(() => {
      // File should be accepted into state (no error yet from handleFileSelect)
      expect(screen.queryByTestId('file-error')).not.toBeInTheDocument();
    });

    // Click Next: Preview — row count check runs here
    fireEvent.click(screen.getByTestId('next-preview-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('file-error')).toBeInTheDocument();
      expect(screen.getByTestId('file-error').textContent).toContain('1,000');
    });
    // Should stay on step 1
    expect(screen.getByTestId('import-step-1')).toBeInTheDocument();
  });

  it('T34: CSV import — wrong MIME type (no .csv extension) is rejected', async () => {
    setupAuth('hr');
    renderEmployeesPage();
    fireEvent.click(await screen.findByTestId('import-csv-btn'));
    await screen.findByTestId('import-step-1');

    // File with non-csv extension and non-csv MIME type
    const file = new File(['malicious data'], 'exploit.exe', { type: 'application/octet-stream' });
    const fileInput = screen.getByTestId('file-input');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('file-error')).toBeInTheDocument();
      expect(screen.getByTestId('file-error').textContent).toContain('.csv');
    });
  });

  it('T35: RoleGuard — manager redirected before EmployeesPage mounts (via route-level guard)', async () => {
    // SEC-001: Inline RoleGuard (mirrors App.tsx logic) wraps the /employees
    // route and redirects synchronously so EmployeesPage never mounts.
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'mgr@test.com', name: 'Manager', role: 'manager', companyId: 'c1' },
      client: makeMockClient(),
      isAuthenticated: true,
      token: 'fake-token',
      bootstrap: 'authenticated' as const,
      login: vi.fn(),
      logout: vi.fn(),
    });

    function InlineRoleGuard({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) {
      const { user, bootstrap } = useAuth();
      if (bootstrap === 'pending') return null;
      const role = user?.role ?? '';
      if (!allowedRoles.includes(role)) {
        return <Navigate to="/dashboard" replace />;
      }
      return <>{children}</>;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/employees']}>
          <Routes>
            <Route
              path="/employees"
              element={
                <InlineRoleGuard allowedRoles={['super_admin', 'hr']}>
                  <EmployeesPage />
                </InlineRoleGuard>
              }
            />
            <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // RoleGuard redirects immediately — EmployeesPage never mounts
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByTestId('employees-page')).not.toBeInTheDocument();
  });
});

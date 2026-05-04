/**
 * employees.ts — API fetch functions for ACMD employees.
 *
 * Used by EmployeesPage (ACMD-144 / ACMD-152) via direct calls.
 * All JSON functions accept an AuthenticatedClient from useAuth().
 *
 * Binary endpoints (import template, export CSV) and multipart
 * (CSV import) use raw fetch with 401→/login guard since
 * AuthenticatedClient.request() parses JSON only.
 */

import type { AuthenticatedClient } from '@/lib/api-client';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Employee {
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

export interface EmployeeListResponse {
  employees: Employee[];
  total: number;
  limit: number;
  offset: number;
}

export interface EmployeeResponse {
  employee: Employee;
}

export interface CreateEmployeeBody {
  name: string;
  email: string;
  position?: string;
  department?: string;
  managerId?: string | null;
  hireDate?: string;
}

export interface UpdateEmployeeBody {
  name?: string;
  position?: string;
  department?: string;
  managerId?: string | null;
  hireDate?: string;
  employmentStatus?: 'active' | 'on_leave' | 'terminated';
}

export interface DeleteEmployeeResponse {
  message: string;
}

export interface ImportEmployeesResponse {
  imported: number;
  skipped: number;
  errors?: Array<{ row: number; error: string; data?: Record<string, string> }>;
}

export interface ListEmployeesParams {
  search?: string;
  employmentStatus?: string;
  department?: string;
  hasActiveCase?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * List employees with optional filters and pagination.
 * GET /api/v1/employees
 */
export async function listEmployees(
  client: AuthenticatedClient,
  params: ListEmployeesParams = {},
): Promise<EmployeeListResponse> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.employmentStatus) searchParams.set('employmentStatus', params.employmentStatus);
  if (params.department) searchParams.set('department', params.department);
  if (params.hasActiveCase) searchParams.set('hasActiveCase', params.hasActiveCase);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  const path = query ? `/api/v1/employees?${query}` : '/api/v1/employees';
  return client.request<EmployeeListResponse>(path);
}

/**
 * Get a single employee by ID.
 * GET /api/v1/employees/:id
 */
export async function getEmployee(
  client: AuthenticatedClient,
  id: string,
): Promise<Employee> {
  const response = await client.request<EmployeeResponse>(`/api/v1/employees/${id}`);
  return response.employee;
}

/**
 * Create a new employee.
 * POST /api/v1/employees
 */
export async function createEmployee(
  client: AuthenticatedClient,
  body: CreateEmployeeBody,
): Promise<EmployeeResponse> {
  return client.request<EmployeeResponse>('/api/v1/employees', {
    method: 'POST',
    body,
  });
}

/**
 * Update an existing employee.
 * PUT /api/v1/employees/:id
 */
export async function updateEmployee(
  client: AuthenticatedClient,
  id: string,
  body: UpdateEmployeeBody,
): Promise<EmployeeResponse> {
  return client.request<EmployeeResponse>(`/api/v1/employees/${id}`, {
    method: 'PUT',
    body,
  });
}

/**
 * Delete (deactivate) an employee.
 * DELETE /api/v1/employees/:id
 */
export async function deleteEmployee(
  client: AuthenticatedClient,
  id: string,
): Promise<DeleteEmployeeResponse> {
  return client.request<DeleteEmployeeResponse>(`/api/v1/employees/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Download the CSV import template.
 * GET /api/v1/employees/import/template
 *
 * NOTE: Returns binary CSV data — uses raw fetch with credentials since
 * AuthenticatedClient.request() parses JSON. Acceptable exception for
 * binary download endpoints (per ACMD-152 task spec / same as letters.ts).
 */
export async function downloadImportTemplate(): Promise<void> {
  const url = `${BASE_URL}/api/v1/employees/import/template`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  if (!response.ok) {
    throw new Error(`Template download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'employees-import-template.csv';
  a.click();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Import employees from a CSV file (multipart/form-data).
 * POST /api/v1/employees/import
 *
 * NOTE: Uses raw fetch with 401 guard since AuthenticatedClient.request()
 * doesn't support multipart/form-data (per ACMD-152 task spec).
 */
export async function importEmployees(file: File): Promise<ImportEmployeesResponse> {
  const url = `${BASE_URL}/api/v1/employees/import`;
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const data = await response.json();

  if (!response.ok) {
    throw Object.assign(new Error('Import failed'), { status: response.status, data });
  }

  return data as ImportEmployeesResponse;
}

/**
 * Export employees as CSV (binary download).
 * POST /api/v1/employees/export
 *
 * NOTE: Returns binary CSV data — uses raw fetch with 401 guard since
 * AuthenticatedClient.request() parses JSON. Acceptable exception for
 * binary download endpoints (per ACMD-152 task spec).
 */
export async function exportEmployeesCsv(ids: string[]): Promise<Blob> {
  const url = `${BASE_URL}/api/v1/employees/export`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`);
  }

  return response.blob();
}

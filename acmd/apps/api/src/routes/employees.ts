/**
 * Employee CRUD API Routes for AccommodateAI.
 *
 * Endpoints:
 *   POST   /api/v1/employees              — Create employee
 *   GET    /api/v1/employees              — List with search + pagination + filter
 *   GET    /api/v1/employees/:id          — Get employee detail
 *   PUT    /api/v1/employees/:id          — Update employee
 *   DELETE /api/v1/employees/:id          — Soft delete employee
 *   POST   /api/v1/employees/import       — CSV import + validate + error report
 *   GET    /api/v1/employees/import/template — Download CSV template
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - POST/PUT/DELETE/import require admin or hr role
 *   - GET allows all roles but scoped to company
 *   - Input validation with Zod
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  createEmployee,
  getEmployeeById,
  listEmployees,
  updateEmployee,
  softDeleteEmployee,
  importEmployeesFromCsv,
  generateCsvTemplate,
} from '../services/employeeService.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
] as const;

const createEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  email: z.string().email('Invalid email format').max(255).optional().nullable(),
  position: z.string().max(255).optional().nullable(),
  department: z.string().max(255).optional().nullable(),
  state: z.string().toUpperCase().refine(
    (v) => !v || US_STATES.includes(v as typeof US_STATES[number]),
    { message: 'Must be a valid US state abbreviation' },
  ).optional().nullable(),
  hrisId: z.string().max(255).optional().nullable(),
  managerId: z.string().uuid('managerId must be a valid UUID').optional().nullable(),
  hireDate: z.string().optional().nullable(),
});

const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email('Invalid email format').max(255).optional().nullable(),
  position: z.string().max(255).optional().nullable(),
  department: z.string().max(255).optional().nullable(),
  state: z.string().toUpperCase().refine(
    (v) => !v || US_STATES.includes(v as typeof US_STATES[number]),
    { message: 'Must be a valid US state abbreviation' },
  ).optional().nullable(),
  hrisId: z.string().max(255).optional().nullable(),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).optional(),
});

const listEmployeesQuerySchema = z.object({
  search: z.string().max(100).optional(),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const acmdRequireAdminOrHr = requireRole('super_admin', 'hr');

// ---------------------------------------------------------------------------
// UUID validation helper
// ---------------------------------------------------------------------------

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const employees = new Hono<AuthEnv>();

// All employee routes require authentication + completed onboarding
// (RS-013 / Q-001 — pre-onboarding users rejected with 403).
employees.use('*', acmdTenantGuard, requireOnboarded);

/**
 * GET /employees/import/template — Download CSV import template
 * Requires: any authenticated role
 *
 * NOTE: This route must be registered BEFORE /:id to avoid conflict.
 */
employees.get('/import/template', async (c) => {
  const csv = generateCsvTemplate();
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="employee_import_template.csv"');
  return c.body(csv);
});

/**
 * POST /employees/import — CSV import employees
 * Requires: admin or hr role
 * Body: raw CSV text (Content-Type: text/csv or multipart)
 */
employees.post('/import', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');

  // FIX-8: Check content-length header for size limit (5MB)
  const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5MB
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_CSV_SIZE) {
    return c.json({ error: 'CSV file too large. Maximum size is 5MB.' }, 413);
  }

  let csvText: string;

  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    csvText = await c.req.text();
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded. Use field name "file"' }, 400);
    }
    csvText = await file.text();
  } else {
    // Try reading as text anyway
    try {
      csvText = await c.req.text();
    } catch {
      return c.json({ error: 'Unsupported content type. Use text/csv or multipart/form-data' }, 400);
    }
  }

  if (!csvText || csvText.trim().length === 0) {
    return c.json({ error: 'CSV content is empty' }, 400);
  }

  // FIX-8: Check actual body size after reading (content-length may be spoofed)
  if (new TextEncoder().encode(csvText).byteLength > MAX_CSV_SIZE) {
    return c.json({ error: 'CSV file too large. Maximum size is 5MB.' }, 413);
  }

  try {
    const result = await importEmployeesFromCsv(csvText, companyId, userId);
    return c.json(result, 200);
  } catch (err) {
    console.error('[Employees] Import error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to import employees' }, 500);
  }
});

/**
 * POST /employees — Create a new employee
 * Requires: admin or hr role
 * Body: { name, email?, position?, department?, state?, hrisId?, managerId?, hireDate? }
 */
employees.post('/', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = createEmployeeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const employee = await createEmployee(
      {
        companyId,
        name: parsed.data.name,
        email: parsed.data.email,
        position: parsed.data.position,
        department: parsed.data.department,
        state: parsed.data.state,
        hrisId: parsed.data.hrisId,
        managerId: parsed.data.managerId,
        hireDate: parsed.data.hireDate,
      },
      userId,
    );
    return c.json({ employee }, 201);
  } catch (err) {
    console.error('[Employees] Create error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to create employee' }, 500);
  }
});

/**
 * GET /employees — List employees with search + pagination + filter
 * Requires: any authenticated role (scoped to company)
 * Query: ?search=john&employmentStatus=active&limit=20&offset=0
 */
employees.get('/', async (c) => {
  const companyId = c.get('companyId');

  const query = c.req.query();
  const parsed = listEmployeesQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid query parameters',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await listEmployees({
      companyId,
      search: parsed.data.search,
      employmentStatus: parsed.data.employmentStatus,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return c.json({
      employees: result.employees,
      total: result.total,
      limit: parsed.data.limit ?? 20,
      offset: parsed.data.offset ?? 0,
    }, 200);
  } catch (err) {
    console.error('[Employees] List error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list employees' }, 500);
  }
});

/**
 * GET /employees/:id — Get employee detail
 * Requires: any authenticated role (scoped to company)
 */
employees.get('/:id', async (c) => {
  const companyId = c.get('companyId');
  const employeeId = c.req.param('id');

  if (!uuidRegex.test(employeeId)) {
    return c.json({ error: 'Invalid employee ID format' }, 400);
  }

  try {
    const employee = await getEmployeeById(employeeId, companyId);
    if (!employee) {
      return c.json({ error: 'Employee not found' }, 404);
    }
    return c.json({ employee }, 200);
  } catch (err) {
    console.error('[Employees] Get error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get employee' }, 500);
  }
});

/**
 * PUT /employees/:id — Update employee
 * Requires: admin or hr role
 * Body: { name?, email?, position?, department?, state?, hrisId?, employmentStatus? }
 */
employees.put('/:id', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const employeeId = c.req.param('id');

  if (!uuidRegex.test(employeeId)) {
    return c.json({ error: 'Invalid employee ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = updateEmployeeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  // At least one field must be provided
  const hasFields = Object.values(parsed.data).some((v) => v !== undefined);
  if (!hasFields) {
    return c.json({ error: 'At least one field is required for update' }, 400);
  }

  try {
    const result = await updateEmployee(employeeId, companyId, userId, parsed.data);
    if (!result) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    const response: Record<string, unknown> = { employee: result.employee };
    if (result.terminationFlags.length > 0) {
      response['terminationFlags'] = result.terminationFlags;
    }

    return c.json(response, 200);
  } catch (err) {
    console.error('[Employees] Update error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to update employee' }, 500);
  }
});

/**
 * DELETE /employees/:id — Soft delete employee
 * Requires: admin or hr role
 */
employees.delete('/:id', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const employeeId = c.req.param('id');

  if (!uuidRegex.test(employeeId)) {
    return c.json({ error: 'Invalid employee ID format' }, 400);
  }

  try {
    const deleted = await softDeleteEmployee(employeeId, companyId, userId);
    if (!deleted) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    return c.json({ message: 'Employee deleted', employee: deleted }, 200);
  } catch (err) {
    console.error('[Employees] Delete error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to delete employee' }, 500);
  }
});

export { employees as employeeRoutes };

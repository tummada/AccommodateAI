/**
 * Employee CRUD service for AccommodateAI.
 *
 * Handles:
 *   - Create / Read / Update / Soft-delete employees
 *   - CSV import with row-level validation + error report
 *   - Quick-add employee (atomic — used by case creation flow)
 *   - Termination handling: flag open cases as HIGH RISK
 *
 * SECURITY:
 *   - All queries scoped to companyId (tenant isolation)
 *   - Soft delete only — deletedAt timestamp, never hard delete
 *   - Audit log every create/update/delete action
 */

import { eq, and, sql, isNull, or, ilike } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdEmployees,
  acmdAuditLogs,
  acmdCases,
  type AcmdEmployee,
  type NewAcmdEmployee,
} from '@acmd/db';
import type { DbOrTx } from './caseService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateEmployeeInput {
  companyId: string;
  name: string;
  email?: string | null;
  position?: string | null;
  department?: string | null;
  state?: string | null;
  hrisId?: string | null;
  managerId?: string | null;
  hireDate?: string | null;
}

export interface UpdateEmployeeInput {
  name?: string;
  email?: string | null;
  position?: string | null;
  department?: string | null;
  state?: string | null;
  hrisId?: string | null;
  employmentStatus?: string;
}

export interface ListEmployeesOptions {
  companyId: string;
  search?: string;
  employmentStatus?: string;
  limit?: number;
  offset?: number;
}

export interface CsvImportRow {
  name: string;
  email?: string;
  position?: string;
  department?: string;
  state?: string;
  hris_id?: string;
}

export interface CsvImportError {
  row: number;
  field: string;
  message: string;
}

export interface CsvImportResult {
  imported: number;
  errors: CsvImportError[];
  total: number;
}

export interface TerminationFlag {
  caseId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Audit Log Helper (employee-scoped — caseId nullable)
// ---------------------------------------------------------------------------

/**
 * Write an audit log entry for employee actions.
 * Uses 'case_updated' action with descriptive metadata since the audit enum
 * does not include employee-specific actions.
 */
async function writeEmployeeAuditLog(params: {
  companyId: string;
  action: string;
  actorId: string;
  metadata?: Record<string, unknown>;
}, txDb: DbOrTx = db): Promise<void> {
  await txDb.insert(acmdAuditLogs).values({
    companyId: params.companyId,
    caseId: null,
    action: 'case_updated',
    actorId: params.actorId,
    metadata: {
      employeeAction: params.action,
      ...(params.metadata ?? {}),
    },
  });
}

// ---------------------------------------------------------------------------
// US State validation
// ---------------------------------------------------------------------------

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
]);

function isValidUSState(state: string): boolean {
  return US_STATES.has(state.toUpperCase());
}

// FIX-9: Escape special characters in ILIKE patterns to prevent wildcard injection
function escapeIlike(str: string): string {
  return str.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Create a new employee.
 */
export async function createEmployee(
  data: CreateEmployeeInput,
  actorId: string,
): Promise<AcmdEmployee> {
  const insertData: NewAcmdEmployee = {
    companyId: data.companyId,
    name: data.name.trim(),
    email: data.email?.trim() ?? null,
    position: data.position?.trim() ?? null,
    department: data.department?.trim() ?? null,
    state: data.state?.toUpperCase().trim() ?? null,
    hrisId: data.hrisId?.trim() ?? null,
    employmentStatus: 'active',
  };

  const employee = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(acmdEmployees)
      .values(insertData)
      .returning();

    await writeEmployeeAuditLog({
      companyId: data.companyId,
      action: 'employee_created',
      actorId,
      metadata: { employeeId: inserted.id, name: data.name },
    }, tx);

    return inserted as AcmdEmployee;
  });

  return employee;
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

/**
 * Get a single employee by ID + company_id.
 * Excludes soft-deleted records.
 */
export async function getEmployeeById(
  employeeId: string,
  companyId: string,
): Promise<AcmdEmployee | null> {
  const [row] = await db
    .select()
    .from(acmdEmployees)
    .where(
      and(
        eq(acmdEmployees.id, employeeId),
        eq(acmdEmployees.companyId, companyId),
        isNull(acmdEmployees.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  return row as AcmdEmployee;
}

/**
 * List employees with search, filter, and pagination.
 */
export async function listEmployees(
  options: ListEmployeesOptions,
): Promise<{ employees: AcmdEmployee[]; total: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [
    eq(acmdEmployees.companyId, options.companyId),
    isNull(acmdEmployees.deletedAt),
  ];

  if (options.search) {
    const term = `%${escapeIlike(options.search)}%`;
    conditions.push(
      or(
        ilike(acmdEmployees.name, term),
        ilike(acmdEmployees.email, term),
        ilike(acmdEmployees.department, term),
      ),
    );
  }

  if (options.employmentStatus) {
    conditions.push(eq(acmdEmployees.employmentStatus, options.employmentStatus));
  }

  const whereClause = and(...conditions);

  // Count total
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(acmdEmployees)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  // Fetch paginated results
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const rows = await db
    .select()
    .from(acmdEmployees)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(acmdEmployees.name);

  return { employees: rows as AcmdEmployee[], total };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

/**
 * Update an employee. Returns null if not found.
 * Handles termination flagging when status changes to 'terminated'.
 */
export async function updateEmployee(
  employeeId: string,
  companyId: string,
  actorId: string,
  data: UpdateEmployeeInput,
): Promise<{ employee: AcmdEmployee; terminationFlags: TerminationFlag[] } | null> {
  // Verify employee exists and belongs to company
  const existing = await getEmployeeById(employeeId, companyId);
  if (!existing) return null;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (data.name !== undefined) updateData['name'] = data.name.trim();
  if (data.email !== undefined) updateData['email'] = data.email?.trim() ?? null;
  if (data.position !== undefined) updateData['position'] = data.position?.trim() ?? null;
  if (data.department !== undefined) updateData['department'] = data.department?.trim() ?? null;
  if (data.state !== undefined) updateData['state'] = data.state?.toUpperCase().trim() ?? null;
  if (data.hrisId !== undefined) updateData['hrisId'] = data.hrisId?.trim() ?? null;
  if (data.employmentStatus !== undefined) updateData['employmentStatus'] = data.employmentStatus;

  // FIX-5: Wrap update + audit log in a transaction
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(acmdEmployees)
      .set(updateData)
      .where(
        and(
          eq(acmdEmployees.id, employeeId),
          eq(acmdEmployees.companyId, companyId),
          isNull(acmdEmployees.deletedAt),
        ),
      )
      .returning();

    if (!updated) return null;

    // Audit log
    await writeEmployeeAuditLog({
      companyId,
      action: 'employee_updated',
      actorId,
      metadata: { employeeId, changes: data },
    }, tx);

    return { employee: updated as AcmdEmployee };
  });

  if (!result) return null;

  // Termination handling (runs outside txn — may involve multiple table reads)
  let terminationFlags: TerminationFlag[] = [];
  if (
    data.employmentStatus === 'terminated'
    && existing.employmentStatus !== 'terminated'
  ) {
    terminationFlags = await handleTermination(employeeId, companyId, actorId);
  }

  return { employee: result.employee, terminationFlags };
}

// ---------------------------------------------------------------------------
// SOFT DELETE
// ---------------------------------------------------------------------------

/**
 * Soft-delete an employee (set deletedAt). Never hard-deletes.
 * Returns null if not found.
 */
export async function softDeleteEmployee(
  employeeId: string,
  companyId: string,
  actorId: string,
): Promise<AcmdEmployee | null> {
  const existing = await getEmployeeById(employeeId, companyId);
  if (!existing) return null;

  const now = new Date();

  // FIX-5: Wrap soft-delete + audit log in a transaction
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(acmdEmployees)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(acmdEmployees.id, employeeId),
          eq(acmdEmployees.companyId, companyId),
          isNull(acmdEmployees.deletedAt),
        ),
      )
      .returning();

    if (!row) return null;

    await writeEmployeeAuditLog({
      companyId,
      action: 'employee_deleted',
      actorId,
      metadata: { employeeId, name: existing.name },
    }, tx);

    return row as AcmdEmployee;
  });

  return deleted;
}

// ---------------------------------------------------------------------------
// TERMINATION HANDLING
// ---------------------------------------------------------------------------

/**
 * When an employee is terminated:
 * 1. Find any open cases for this employee
 * 2. Flag them as HIGH RISK (do NOT auto-close)
 * 3. Check if employee was terminated <6 months after any case closure → flag for review
 */
async function handleTermination(
  employeeId: string,
  companyId: string,
  actorId: string,
): Promise<TerminationFlag[]> {
  const flags: TerminationFlag[] = [];

  // 1. Find open cases (not closed/approved/denied)
  const openCases = await db
    .select({ id: acmdCases.id, status: acmdCases.status })
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.employeeId, employeeId),
        eq(acmdCases.companyId, companyId),
        isNull(acmdCases.deletedAt),
      ),
    );

  const terminalStatuses = ['closed', 'approved', 'denied'];

  for (const c of openCases) {
    if (!terminalStatuses.includes(c.status)) {
      // Flag as HIGH RISK
      flags.push({
        caseId: c.id,
        reason: 'Employee terminated while case is open — HIGH RISK — do not auto-close',
      });

      // Write audit log for the flagging
      await db.insert(acmdAuditLogs).values({
        companyId,
        caseId: c.id,
        action: 'case_updated',
        actorId,
        metadata: {
          event: 'termination_risk_flag',
          employeeId,
          risk: 'HIGH',
          reason: 'Employee terminated while accommodation case is open',
        },
      });
    }
  }

  // 2. Check recently closed cases (<6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const recentlyClosedCases = await db
    .select({ id: acmdCases.id, closedAt: acmdCases.closedAt })
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.employeeId, employeeId),
        eq(acmdCases.companyId, companyId),
        eq(acmdCases.status, 'closed'),
        isNull(acmdCases.deletedAt),
      ),
    );

  for (const c of recentlyClosedCases) {
    if (c.closedAt && c.closedAt >= sixMonthsAgo) {
      flags.push({
        caseId: c.id,
        reason: 'Employee terminated within 6 months of case closure — flag for review (potential retaliation)',
      });

      await db.insert(acmdAuditLogs).values({
        companyId,
        caseId: c.id,
        action: 'case_updated',
        actorId,
        metadata: {
          event: 'termination_review_flag',
          employeeId,
          closedAt: c.closedAt.toISOString(),
          reason: 'Termination within 6 months of accommodation case closure',
        },
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// CSV IMPORT
// ---------------------------------------------------------------------------

/**
 * Parse and import employees from CSV text.
 * Validates every row and returns detailed error report.
 *
 * Expected columns: name, email, position, department, state, hris_id
 * - name is required
 * - email validated if present
 * - state validated as US state if present
 */
export async function importEmployeesFromCsv(
  csvText: string,
  companyId: string,
  actorId: string,
): Promise<CsvImportResult> {
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { imported: 0, errors: [{ row: 0, field: 'file', message: 'CSV file is empty' }], total: 0 };
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const positionIdx = headers.indexOf('position');
  const departmentIdx = headers.indexOf('department');
  const stateIdx = headers.indexOf('state');
  const hrisIdIdx = headers.indexOf('hris_id');

  if (nameIdx === -1) {
    return {
      imported: 0,
      errors: [{ row: 1, field: 'header', message: 'Missing required column: name' }],
      total: 0,
    };
  }

  const errors: CsvImportError[] = [];
  const validRows: NewAcmdEmployee[] = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Process data rows
  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1; // 1-indexed, accounting for header
    const fields = parseCsvLine(lines[i]);

    const name = fields[nameIdx]?.trim();
    const email = emailIdx >= 0 ? fields[emailIdx]?.trim() : undefined;
    const position = positionIdx >= 0 ? fields[positionIdx]?.trim() : undefined;
    const department = departmentIdx >= 0 ? fields[departmentIdx]?.trim() : undefined;
    const state = stateIdx >= 0 ? fields[stateIdx]?.trim() : undefined;
    const hrisId = hrisIdIdx >= 0 ? fields[hrisIdIdx]?.trim() : undefined;

    // Validate name (required)
    if (!name || name.length === 0) {
      errors.push({ row: rowNum, field: 'name', message: 'Name is required' });
      continue;
    }

    if (name.length > 255) {
      errors.push({ row: rowNum, field: 'name', message: 'Name must be 255 characters or less' });
      continue;
    }

    // Validate email if provided
    if (email && email.length > 0 && !emailRegex.test(email)) {
      errors.push({ row: rowNum, field: 'email', message: `Invalid email format: ${email}` });
      continue;
    }

    // Validate state if provided
    if (state && state.length > 0 && !isValidUSState(state)) {
      errors.push({ row: rowNum, field: 'state', message: `Invalid US state: ${state}` });
      continue;
    }

    validRows.push({
      companyId,
      name,
      email: email || null,
      position: position || null,
      department: department || null,
      state: state ? state.toUpperCase() : null,
      hrisId: hrisId || null,
      employmentStatus: 'active',
    });
  }

  // Batch insert valid rows
  let imported = 0;
  if (validRows.length > 0) {
    // Insert in batches of 100 to avoid massive queries
    const batchSize = 100;
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize);
      await db.insert(acmdEmployees).values(batch);
      imported += batch.length;
    }

    // Single audit log for bulk import
    await writeEmployeeAuditLog({
      companyId,
      action: 'employees_imported',
      actorId,
      metadata: { imported, errors: errors.length, total: lines.length - 1 },
    });
  }

  return {
    imported,
    errors,
    total: lines.length - 1, // Exclude header
  };
}

/**
 * Parse a single CSV line respecting quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

/**
 * Generate a CSV template for employee import.
 */
export function generateCsvTemplate(): string {
  return 'name,email,position,department,state,hris_id\nJane Doe,jane@example.com,Software Engineer,Engineering,CA,EMP-001\n';
}

// ---------------------------------------------------------------------------
// QUICK-ADD (Internal service function for case creation)
// ---------------------------------------------------------------------------

/**
 * Quick-add employee during case creation.
 * This is an internal service function called by caseService (not a route).
 * Creates the employee atomically within a transaction.
 *
 * @param data - Employee fields from inline case creation
 * @param companyId - Company ID from auth context
 * @param actorId - User ID who creates the case
 * @param txDb - Transaction handle from calling code
 * @returns The newly created employee
 */
export async function quickAddEmployee(
  data: {
    name: string;
    email?: string | null;
    position?: string | null;
    department?: string | null;
    state?: string | null;
  },
  companyId: string,
  actorId: string,
  txDb: DbOrTx = db,
): Promise<AcmdEmployee> {
  const insertData: NewAcmdEmployee = {
    companyId,
    name: data.name.trim(),
    email: data.email?.trim() ?? null,
    position: data.position?.trim() ?? null,
    department: data.department?.trim() ?? null,
    state: data.state?.toUpperCase().trim() ?? null,
    employmentStatus: 'active',
  };

  const [inserted] = await txDb
    .insert(acmdEmployees)
    .values(insertData)
    .returning();

  await writeEmployeeAuditLog({
    companyId,
    action: 'employee_quick_added',
    actorId,
    metadata: { employeeId: inserted.id, name: data.name, source: 'case_creation' },
  }, txDb);

  return inserted as AcmdEmployee;
}

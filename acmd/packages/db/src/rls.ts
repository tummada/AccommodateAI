// @acmd/db — Row Level Security helpers
// Sets PostgreSQL session variable for tenant isolation (defense-in-depth)

import type { Sql } from 'postgres';

/**
 * Set the current tenant context for RLS policies.
 * Must be called within a transaction — uses SET LOCAL so it auto-resets on tx end.
 *
 * @example
 * ```ts
 * await sql.begin(async (tx) => {
 *   await setTenantContext(tx, companyId);
 *   // All queries in this tx are now scoped to companyId
 * });
 * ```
 */
export async function setTenantContext(
  sql: Sql,
  companyId: string,
): Promise<void> {
  // Validate UUID format to prevent injection
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(companyId)) {
    throw new Error(`Invalid company ID format: ${companyId}`);
  }

  await sql`SELECT set_config('app.current_company_id', ${companyId}, true)`;
}

/**
 * Clear the tenant context. Useful for cleanup in tests.
 * Uses SET LOCAL so it auto-resets on transaction end.
 */
export async function clearTenantContext(sql: Sql): Promise<void> {
  await sql`SELECT set_config('app.current_company_id', '', true)`;
}

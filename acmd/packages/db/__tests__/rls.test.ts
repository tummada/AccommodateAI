/**
 * RLS (Row Level Security) integration tests for acmd_ tables.
 *
 * Requires a real PostgreSQL database with:
 *   1. All acmd_ tables created (schema applied)
 *   2. The RLS migration (0017_rls_tenant_isolation.sql) applied
 *
 * Set DATABASE_URL to run these tests.
 * Without DATABASE_URL, the entire suite is skipped.
 *
 * Architecture:
 *   - `sql` = superuser connection (setup/teardown, bypasses RLS + triggers)
 *   - Tests use `SET ROLE acmd_app` within transactions to enforce RLS
 *     (non-superuser role that respects RLS policies)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setTenantContext, clearTenantContext } from '../src/rls.js';

const DATABASE_URL = process.env['DATABASE_URL'];

// Skip entire suite if no DATABASE_URL
const describeRLS = DATABASE_URL ? describe : describe.skip;

describeRLS('RLS tenant isolation', () => {
  let sql: ReturnType<typeof postgres>;

  // Two test tenants
  const TENANT_A_ID = '00000000-0000-4000-a000-000000000001';
  const TENANT_B_ID = '00000000-0000-4000-a000-000000000002';

  // IDs for test data
  const USER_A_ID = '10000000-0000-4000-a000-000000000001';
  const USER_B_ID = '10000000-0000-4000-a000-000000000002';
  const EMPLOYEE_A_ID = '20000000-0000-4000-a000-000000000001';
  const EMPLOYEE_B_ID = '20000000-0000-4000-a000-000000000002';
  const CASE_A_ID = '30000000-0000-4000-a000-000000000001';
  const CASE_B_ID = '30000000-0000-4000-a000-000000000002';
  const APPROVAL_SETTINGS_A_ID = '40000000-0000-4000-a000-000000000001';
  const APPROVAL_SETTINGS_B_ID = '40000000-0000-4000-a000-000000000002';
  const DECISION_A_ID = '50000000-0000-4000-a000-000000000001';
  const DECISION_B_ID = '50000000-0000-4000-a000-000000000002';

  const APP_ROLE = 'acmd_app'; // SECURITY: hardcoded constant — never derive from user input

  /**
   * Helper: run a callback as non-superuser (SET ROLE acmd_app)
   * so that RLS policies are enforced. RESET ROLE at end restores superuser.
   */
  async function asAppRole(
    callback: (tx: ReturnType<typeof postgres>) => Promise<void>,
  ): Promise<void> {
    await sql.begin(async (tx) => {
      // SECURITY: APP_ROLE is hardcoded (line 41) — sql.unsafe required because SET ROLE cannot be parameterized
      await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
      await callback(tx);
      // RESET ROLE happens automatically when transaction ends
    });
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 3 });

    // SECURITY: APP_ROLE is hardcoded (line 41) — safe for string interpolation in test context only
    // Create non-superuser role for RLS testing (idempotent)
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} NOLOGIN;
        END IF;
      END $$;
    `);
    // Grant access to all acmd_ tables so the role can query them
    await sql.unsafe(`
      GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    `);

    // Clean up any previous test data using superuser (reverse FK order)
    // Disable audit_logs append-only trigger for cleanup
    await sql`ALTER TABLE acmd_audit_logs DISABLE TRIGGER acmd_audit_logs_no_delete`;
    await sql`DELETE FROM acmd_case_decisions WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_approval_settings WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_checklist_items WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_letters WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_documents WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_suggestions WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_audit_logs WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_notifications WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_cases WHERE id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_refresh_tokens WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_users WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_employees WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_companies WHERE id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`ALTER TABLE acmd_audit_logs ENABLE TRIGGER acmd_audit_logs_no_delete`;

    // Seed companies (no RLS on acmd_companies)
    await sql`
      INSERT INTO acmd_companies (id, name, plan_tier, subscription_status)
      VALUES
        (${TENANT_A_ID}, 'Tenant A Corp', 'starter', 'active'),
        (${TENANT_B_ID}, 'Tenant B Corp', 'pro', 'active')
    `;

    // Seed users — superuser bypasses RLS, set tenant context for audit triggers
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_company_id', ${TENANT_A_ID}, true)`;
      await tx`
        INSERT INTO acmd_users (id, company_id, name, email, role)
        VALUES (${USER_A_ID}, ${TENANT_A_ID}, 'User A', 'usera@tenanta.com', 'super_admin')
      `;
      await tx`
        INSERT INTO acmd_employees (id, company_id, name)
        VALUES (${EMPLOYEE_A_ID}, ${TENANT_A_ID}, 'Employee A')
      `;
      await tx`
        INSERT INTO acmd_cases (id, company_id, employee_id, type)
        VALUES (${CASE_A_ID}, ${TENANT_A_ID}, ${EMPLOYEE_A_ID}, 'ada')
      `;
    });

    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_company_id', ${TENANT_B_ID}, true)`;
      await tx`
        INSERT INTO acmd_users (id, company_id, name, email, role)
        VALUES (${USER_B_ID}, ${TENANT_B_ID}, 'User B', 'userb@tenantb.com', 'super_admin')
      `;
      await tx`
        INSERT INTO acmd_employees (id, company_id, name)
        VALUES (${EMPLOYEE_B_ID}, ${TENANT_B_ID}, 'Employee B')
      `;
      await tx`
        INSERT INTO acmd_cases (id, company_id, employee_id, type)
        VALUES (${CASE_B_ID}, ${TENANT_B_ID}, ${EMPLOYEE_B_ID}, 'pwfa')
      `;
    });

    // Seed indirect tables
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_company_id', ${TENANT_A_ID}, true)`;
      await tx`
        INSERT INTO acmd_checklist_items (case_id, step_name, step_order)
        VALUES (${CASE_A_ID}, 'Step 1', 1)
      `;
      await tx`
        INSERT INTO acmd_letters (case_id, type, content)
        VALUES (${CASE_A_ID}, 'acknowledgment', 'Letter for Tenant A')
      `;
      await tx`
        INSERT INTO acmd_documents (case_id, filename, storage_path)
        VALUES (${CASE_A_ID}, 'doc_a.pdf', '/storage/doc_a.pdf')
      `;
      await tx`
        INSERT INTO acmd_suggestions (case_id, company_id, name, source)
        VALUES (${CASE_A_ID}, ${TENANT_A_ID}, 'Suggestion A', 'ai')
      `;
      await tx`
        INSERT INTO acmd_notifications (company_id, user_id, type, title)
        VALUES (${TENANT_A_ID}, ${USER_A_ID}, 'case_update', 'Notification A')
      `;
      await tx`
        INSERT INTO acmd_audit_logs (company_id, case_id, action)
        VALUES (${TENANT_A_ID}, ${CASE_A_ID}, 'case_created')
      `;
    });

    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_company_id', ${TENANT_B_ID}, true)`;
      await tx`
        INSERT INTO acmd_checklist_items (case_id, step_name, step_order)
        VALUES (${CASE_B_ID}, 'Step 1', 1)
      `;
      await tx`
        INSERT INTO acmd_letters (case_id, type, content)
        VALUES (${CASE_B_ID}, 'approval', 'Letter for Tenant B')
      `;
      await tx`
        INSERT INTO acmd_documents (case_id, filename, storage_path)
        VALUES (${CASE_B_ID}, 'doc_b.pdf', '/storage/doc_b.pdf')
      `;
      await tx`
        INSERT INTO acmd_suggestions (case_id, company_id, name, source)
        VALUES (${CASE_B_ID}, ${TENANT_B_ID}, 'Suggestion B', 'ai')
      `;
      await tx`
        INSERT INTO acmd_notifications (company_id, user_id, type, title)
        VALUES (${TENANT_B_ID}, ${USER_B_ID}, 'case_update', 'Notification B')
      `;
      await tx`
        INSERT INTO acmd_audit_logs (company_id, case_id, action)
        VALUES (${TENANT_B_ID}, ${CASE_B_ID}, 'case_created')
      `;
    });

    // Seed Phase 4 tables: approval_settings + case_decisions
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_company_id', ${TENANT_A_ID}, true)`;
      await tx`
        INSERT INTO acmd_approval_settings (id, company_id)
        VALUES (${APPROVAL_SETTINGS_A_ID}, ${TENANT_A_ID})
      `;
      await tx`
        INSERT INTO acmd_case_decisions (id, case_id, company_id, decision_type, decided_by, decided_at)
        VALUES (${DECISION_A_ID}, ${CASE_A_ID}, ${TENANT_A_ID}, 'approved', ${USER_A_ID}, now())
      `;
    });

    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_company_id', ${TENANT_B_ID}, true)`;
      await tx`
        INSERT INTO acmd_approval_settings (id, company_id)
        VALUES (${APPROVAL_SETTINGS_B_ID}, ${TENANT_B_ID})
      `;
      await tx`
        INSERT INTO acmd_case_decisions (id, case_id, company_id, decision_type, decided_by, decided_at)
        VALUES (${DECISION_B_ID}, ${CASE_B_ID}, ${TENANT_B_ID}, 'denied', ${USER_B_ID}, now())
      `;
    });
  });

  afterAll(async () => {
    // Clean up test data using superuser (reverse FK order)
    // Disable audit_logs append-only trigger for cleanup
    await sql`ALTER TABLE acmd_audit_logs DISABLE TRIGGER acmd_audit_logs_no_delete`;
    await sql`DELETE FROM acmd_case_decisions WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_approval_settings WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_checklist_items WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_letters WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_documents WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_suggestions WHERE case_id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_audit_logs WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_notifications WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_cases WHERE id = ANY(${[CASE_A_ID, CASE_B_ID]})`;
    await sql`DELETE FROM acmd_refresh_tokens WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_users WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_employees WHERE company_id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`DELETE FROM acmd_companies WHERE id = ANY(${[TENANT_A_ID, TENANT_B_ID]})`;
    await sql`ALTER TABLE acmd_audit_logs ENABLE TRIGGER acmd_audit_logs_no_delete`;

    await sql.end();
  });

  // ---- Test 1: Tenant A cannot see Tenant B data (SELECT isolation) ----
  it('Tenant A SELECT sees only own data across all tables', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_A_ID);

      const cases = await tx`SELECT id FROM acmd_cases`;
      expect(cases).toHaveLength(1);
      expect(cases[0]!.id).toBe(CASE_A_ID);

      const employees = await tx`SELECT id FROM acmd_employees`;
      expect(employees).toHaveLength(1);
      expect(employees[0]!.id).toBe(EMPLOYEE_A_ID);

      const users = await tx`SELECT id FROM acmd_users`;
      expect(users).toHaveLength(1);
      expect(users[0]!.id).toBe(USER_A_ID);

      const checklists = await tx`SELECT case_id FROM acmd_checklist_items`;
      expect(checklists).toHaveLength(1);
      expect(checklists[0]!.case_id).toBe(CASE_A_ID);

      const letters = await tx`SELECT case_id FROM acmd_letters`;
      expect(letters).toHaveLength(1);
      expect(letters[0]!.case_id).toBe(CASE_A_ID);

      const documents = await tx`SELECT case_id FROM acmd_documents`;
      expect(documents).toHaveLength(1);
      expect(documents[0]!.case_id).toBe(CASE_A_ID);

      const suggestions = await tx`SELECT company_id FROM acmd_suggestions`;
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.company_id).toBe(TENANT_A_ID);

      const notifications = await tx`SELECT company_id FROM acmd_notifications`;
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.company_id).toBe(TENANT_A_ID);

      const auditLogs = await tx`SELECT company_id FROM acmd_audit_logs`;
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.company_id).toBe(TENANT_A_ID);
    });
  });

  // ---- Test 2: INSERT across tenants is blocked ----
  it('INSERT with wrong tenant context is blocked', async () => {
    // Set context to Tenant A, try to insert data for Tenant B
    await expect(
      asAppRole(async (tx) => {
        await setTenantContext(tx, TENANT_A_ID);
        // Direct table: try inserting employee for Tenant B
        await tx`
          INSERT INTO acmd_employees (company_id, name)
          VALUES (${TENANT_B_ID}, 'Rogue Employee')
        `;
      }),
    ).rejects.toThrow();

    // Indirect table: try inserting checklist for Tenant B's case
    await expect(
      asAppRole(async (tx) => {
        await setTenantContext(tx, TENANT_A_ID);
        await tx`
          INSERT INTO acmd_checklist_items (case_id, step_name, step_order)
          VALUES (${CASE_B_ID}, 'Rogue Step', 99)
        `;
      }),
    ).rejects.toThrow();
  });

  // ---- Test 3: UPDATE/DELETE across tenants is blocked ----
  it('UPDATE and DELETE across tenants are blocked', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_A_ID);

      // UPDATE should affect 0 rows (Tenant B case not visible)
      const updateResult = await tx`
        UPDATE acmd_cases SET status = 'closed' WHERE id = ${CASE_B_ID}
      `;
      expect(updateResult.count).toBe(0);

      // DELETE should affect 0 rows
      const deleteResult = await tx`
        DELETE FROM acmd_employees WHERE id = ${EMPLOYEE_B_ID}
      `;
      expect(deleteResult.count).toBe(0);

      // Indirect: UPDATE on letters for Tenant B's case
      const letterUpdate = await tx`
        UPDATE acmd_letters SET content = 'hacked' WHERE case_id = ${CASE_B_ID}
      `;
      expect(letterUpdate.count).toBe(0);
    });
  });

  // ---- Test 4: No tenant context = no data visible (deny by default) ----
  it('no tenant context returns empty results', async () => {
    await asAppRole(async (tx) => {
      // Explicitly clear any context
      await clearTenantContext(tx);

      const cases = await tx`SELECT id FROM acmd_cases`;
      expect(cases).toHaveLength(0);

      const employees = await tx`SELECT id FROM acmd_employees`;
      expect(employees).toHaveLength(0);

      const users = await tx`SELECT id FROM acmd_users`;
      expect(users).toHaveLength(0);

      const checklists = await tx`SELECT id FROM acmd_checklist_items`;
      expect(checklists).toHaveLength(0);

      const letters = await tx`SELECT id FROM acmd_letters`;
      expect(letters).toHaveLength(0);

      const documents = await tx`SELECT id FROM acmd_documents`;
      expect(documents).toHaveLength(0);

      const suggestions = await tx`SELECT id FROM acmd_suggestions`;
      expect(suggestions).toHaveLength(0);

      const notifications = await tx`SELECT id FROM acmd_notifications`;
      expect(notifications).toHaveLength(0);

      const auditLogs = await tx`SELECT id FROM acmd_audit_logs`;
      expect(auditLogs).toHaveLength(0);
    });
  });

  // ---- Test 5: Reference tables accessible to all tenants ----
  it('reference tables (compliance_rules, jan_accommodations) accessible without tenant context', async () => {
    // Seed a compliance rule if none exists (using superuser)
    await sql`
      INSERT INTO acmd_compliance_rules (law_type, title, description)
      VALUES ('ada', 'Test ADA Rule', 'For RLS test')
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO acmd_jan_accommodations (condition, accommodation)
      VALUES ('Test Condition', 'Test Accommodation')
      ON CONFLICT DO NOTHING
    `;

    await asAppRole(async (tx) => {
      // No tenant context set — reference tables should still be readable
      await clearTenantContext(tx);

      const rules = await tx`SELECT id FROM acmd_compliance_rules LIMIT 1`;
      expect(rules.length).toBeGreaterThanOrEqual(1);

      const accommodations = await tx`SELECT id FROM acmd_jan_accommodations LIMIT 1`;
      expect(accommodations.length).toBeGreaterThanOrEqual(1);

      // Companies table should also be accessible (no RLS)
      const companies = await tx`SELECT id FROM acmd_companies LIMIT 1`;
      expect(companies.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- Test 6: setTenantContext rejects invalid UUID ----
  it('setTenantContext rejects invalid UUID', async () => {
    await expect(
      asAppRole(async (tx) => {
        await setTenantContext(tx, 'not-a-uuid');
      }),
    ).rejects.toThrow('Invalid company ID format');

    await expect(
      asAppRole(async (tx) => {
        await setTenantContext(tx, "'; DROP TABLE acmd_cases; --");
      }),
    ).rejects.toThrow('Invalid company ID format');
  });

  // ---- Test 7: Tenant B sees only own data (reverse check) ----
  it('Tenant B SELECT sees only own data', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_B_ID);

      const cases = await tx`SELECT id FROM acmd_cases`;
      expect(cases).toHaveLength(1);
      expect(cases[0]!.id).toBe(CASE_B_ID);

      const employees = await tx`SELECT id FROM acmd_employees`;
      expect(employees).toHaveLength(1);
      expect(employees[0]!.id).toBe(EMPLOYEE_B_ID);

      const letters = await tx`SELECT content FROM acmd_letters`;
      expect(letters).toHaveLength(1);
      expect(letters[0]!.content).toBe('Letter for Tenant B');
    });
  });

  // ---- Test 8: Phase 4 — approval_settings RLS isolation ----
  it('Tenant A sees only own approval_settings', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_A_ID);

      const settings = await tx`SELECT id, company_id FROM acmd_approval_settings`;
      expect(settings).toHaveLength(1);
      expect(settings[0]!.id).toBe(APPROVAL_SETTINGS_A_ID);
      expect(settings[0]!.company_id).toBe(TENANT_A_ID);
    });
  });

  // ---- Test 9: Phase 4 — case_decisions RLS isolation ----
  it('Tenant A sees only own case_decisions', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_A_ID);

      const decisions = await tx`SELECT id, company_id, decision_type FROM acmd_case_decisions`;
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.id).toBe(DECISION_A_ID);
      expect(decisions[0]!.company_id).toBe(TENANT_A_ID);
      expect(decisions[0]!.decision_type).toBe('approved');
    });
  });

  // ---- Test 10: Phase 4 — cross-tenant INSERT blocked for approval_settings ----
  it('INSERT with wrong tenant blocked for Phase 4 tables', async () => {
    await expect(
      asAppRole(async (tx) => {
        await setTenantContext(tx, TENANT_A_ID);
        await tx`
          INSERT INTO acmd_approval_settings (company_id)
          VALUES (${TENANT_B_ID})
        `;
      }),
    ).rejects.toThrow();

    await expect(
      asAppRole(async (tx) => {
        await setTenantContext(tx, TENANT_A_ID);
        await tx`
          INSERT INTO acmd_case_decisions (case_id, company_id, decision_type, decided_by, decided_at)
          VALUES (${CASE_B_ID}, ${TENANT_B_ID}, 'denied', ${USER_A_ID}, now())
        `;
      }),
    ).rejects.toThrow();
  });

  // ---- Test 11: Phase 4 — no tenant context = empty for Phase 4 tables ----
  it('no tenant context returns empty for Phase 4 tables', async () => {
    await asAppRole(async (tx) => {
      await clearTenantContext(tx);

      const settings = await tx`SELECT id FROM acmd_approval_settings`;
      expect(settings).toHaveLength(0);

      const decisions = await tx`SELECT id FROM acmd_case_decisions`;
      expect(decisions).toHaveLength(0);
    });
  });

  // ---- Test 12: Phase 4 — UPDATE/DELETE across tenants blocked for Phase 4 tables ----
  it('UPDATE and DELETE across tenants blocked for Phase 4 tables', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_A_ID);

      // UPDATE approval_settings belonging to Tenant B — should affect 0 rows
      const updateSettings = await tx`
        UPDATE acmd_approval_settings SET updated_at = now() WHERE id = ${APPROVAL_SETTINGS_B_ID}
      `;
      expect(updateSettings.count).toBe(0);

      // DELETE approval_settings belonging to Tenant B — should affect 0 rows
      const deleteSettings = await tx`
        DELETE FROM acmd_approval_settings WHERE id = ${APPROVAL_SETTINGS_B_ID}
      `;
      expect(deleteSettings.count).toBe(0);

      // UPDATE case_decisions belonging to Tenant B — should affect 0 rows
      const updateDecisions = await tx`
        UPDATE acmd_case_decisions SET cost_analysis = 'hacked' WHERE id = ${DECISION_B_ID}
      `;
      expect(updateDecisions.count).toBe(0);

      // DELETE case_decisions belonging to Tenant B — should affect 0 rows
      const deleteDecisions = await tx`
        DELETE FROM acmd_case_decisions WHERE id = ${DECISION_B_ID}
      `;
      expect(deleteDecisions.count).toBe(0);
    });
  });

  // ---- Test 13: Phase 4 — Tenant B sees own Phase 4 data (reverse check) ----
  it('Tenant B sees only own Phase 4 data', async () => {
    await asAppRole(async (tx) => {
      await setTenantContext(tx, TENANT_B_ID);

      const settings = await tx`SELECT id FROM acmd_approval_settings`;
      expect(settings).toHaveLength(1);
      expect(settings[0]!.id).toBe(APPROVAL_SETTINGS_B_ID);

      const decisions = await tx`SELECT id, decision_type FROM acmd_case_decisions`;
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.id).toBe(DECISION_B_ID);
      expect(decisions[0]!.decision_type).toBe('denied');
    });
  });
});

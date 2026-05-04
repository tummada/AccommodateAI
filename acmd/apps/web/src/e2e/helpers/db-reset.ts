/**
 * RS-013 — global DB reset helper (E2E only).
 *
 * Runs ONCE via Playwright's `globalSetup` before the test suite:
 *   1. Applies any outstanding auth-db migrations (auth.users,
 *      auth.refresh_tokens, auth.user_products). These are idempotent —
 *      raw SQL files that create tables only when missing is handled by
 *      the `IF NOT EXISTS` pattern we inject below.
 *   2. Applies any outstanding acmd-db migrations (TRUNCATE-safe).
 *   3. TRUNCATE … CASCADE on all test-affected tables so every run starts
 *      with a deterministic empty DB.
 *
 * Connection string:
 *   Prefers E2E_DATABASE_URL (set by playwright.config.ts), then
 *   falls back to AUTH_DATABASE_URL / DATABASE_URL. Always uses the
 *   superuser (`vollos`) because we need CREATE TABLE + TRUNCATE
 *   CASCADE across both schemas.
 *
 * Why no drizzle-kit:
 *   drizzle-kit requires its own config + meta/_journal.json
 *   tracking table. The SQL files are small + stable and reading
 *   them directly keeps the test-only dependency surface minimal.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const AUTH_MIGRATIONS_DIR =
  '/home/ipon/workspace/vollos-ai/vollos-core/packages/auth-db/migrations';
const ACMD_MIGRATIONS_DIR =
  '/home/ipon/workspace/vollos-ai/acmd/packages/db/migrations';

/**
 * Tables cleared between every globalSetup run. Order does not matter
 * because we use TRUNCATE … CASCADE, but listing them explicitly keeps
 * the surface grep-able.
 */
const AUTH_TRUNCATE_TABLES = [
  '"auth"."refresh_tokens"',
  '"auth"."user_products"',
  '"auth"."users"',
];
const ACMD_TRUNCATE_TABLES = [
  '"acmd"."audit_logs"',
  '"acmd"."notifications"',
  '"acmd"."letters"',
  '"acmd"."suggestions"',
  '"acmd"."checklist_items"',
  '"acmd"."case_decisions"',
  '"acmd"."documents"',
  '"acmd"."discussions"',
  '"acmd"."cases"',
  '"acmd"."employees"',
  '"acmd"."approval_settings"',
  '"acmd"."users"',
  '"acmd"."companies"',
];

function getConnectionString(): string {
  const url =
    process.env['E2E_DATABASE_URL']
    ?? process.env['AUTH_DATABASE_URL']
    ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      '[db-reset] E2E_DATABASE_URL / DATABASE_URL not set — globalSetup cannot connect',
    );
  }
  return url;
}

/**
 * Apply a directory of `NNNN_*.sql` files in numeric order. Each file is
 * wrapped in a try/catch so repeat runs do not fail when CREATE TABLE
 * collides with existing tables. The SQL files emitted by drizzle-kit do
 * NOT use `IF NOT EXISTS`, so we fall back to swallowing SQLSTATE 42P07
 * (duplicate_table) / 42P16 (duplicate_column) / 42710 (duplicate_object).
 */
async function applyRawMigrations(
  dir: string,
  sql: postgres.Sql,
): Promise<{ ran: number; skipped: number }> {
  let ran = 0;
  let skipped = 0;
  const files = (await readdir(dir))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();

  for (const file of files) {
    const full = join(dir, file);
    const raw = await readFile(full, 'utf-8');
    // acmd migrations occasionally contain a DOWN block after a `-- ── DOWN`
    // marker; strip to get the UP-only portion to match run-migrations.ts.
    const upSql = raw.split(/^-- ─+ DOWN/m)[0] ?? raw;
    try {
      await sql.unsafe(upSql);
      ran++;
    } catch (err) {
      // Idempotent tolerant list — keeps reruns working against a DB
      // where the schema already exists but the migration tracker does
      // not (we don't keep our own tracker at E2E level).
      const code = (err as { code?: string })?.code ?? '';
      // 42P07 duplicate_table, 42P16 invalid_table_definition (re-add column),
      // 42710 duplicate_object (type/constraint), 42701 duplicate_column,
      // 42P06 duplicate_schema (seen when CREATE SCHEMA runs against an
      // already-provisioned DB).
      if (
        code === '42P06'
        || code === '42P07'
        || code === '42P16'
        || code === '42710'
        || code === '42701'
      ) {
        skipped++;
        continue;
      }
      // Surface any other failure — typically a real syntax issue that
      // would silently break tests if ignored.
      // eslint-disable-next-line no-console
      console.error(`[db-reset] migration failed: ${file}`, err);
      throw err;
    }
  }
  return { ran, skipped };
}

/**
 * Probe whether a table exists in a given schema. Used to short-circuit
 * migrations when the DB is already at the expected shape — re-running
 * drizzle-kit SQL against an already-provisioned schema blows up
 * because the whole file is one multi-statement query and aborts on
 * the first `CREATE SCHEMA` / `CREATE TABLE` that collides.
 */
async function tableExists(
  sql: postgres.Sql,
  schema: string,
  table: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = ${schema} AND table_name = ${table}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

/**
 * Full reset + migrate. Safe to call multiple times — migrations are
 * only applied when the expected tables are missing, and TRUNCATE
 * CASCADE works on both fresh and pre-populated databases.
 */
export async function resetDatabases(): Promise<void> {
  const connectionString = getConnectionString();
  // max: 1 avoids deadlocks while migrating + truncating in one pool.
  const sql = postgres(connectionString, { max: 1 });

  try {
    // Defensive: ensure both schemas exist before any CREATE TABLE fires.
    // In a fresh Docker volume the postgres init script (init-db.sql) does
    // this; in a manually-dropped DB we cover for a missing schema here.
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth`);
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS acmd`);

    const authReady =
      (await tableExists(sql, 'auth', 'users'))
      && (await tableExists(sql, 'auth', 'refresh_tokens'))
      && (await tableExists(sql, 'auth', 'user_products'));

    const acmdReady =
      (await tableExists(sql, 'acmd', 'users'))
      && (await tableExists(sql, 'acmd', 'companies'))
      && (await tableExists(sql, 'acmd', 'audit_logs'));

    const authResult = authReady
      ? { ran: 0, skipped: -1 as const }
      : await applyRawMigrations(AUTH_MIGRATIONS_DIR, sql);

    const acmdResult = acmdReady
      ? { ran: 0, skipped: -1 as const }
      : await applyRawMigrations(ACMD_MIGRATIONS_DIR, sql);

    // TRUNCATE ALL CASCADE — single statement keeps the FK graph consistent.
    const tables = [...AUTH_TRUNCATE_TABLES, ...ACMD_TRUNCATE_TABLES].join(', ');
    await sql.unsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);

    // eslint-disable-next-line no-console
    console.log(
      `[db-reset] ok — auth migrations: ${
        authReady ? 'already-applied' : `ran=${authResult.ran} skipped=${authResult.skipped}`
      }, acmd migrations: ${
        acmdReady ? 'already-applied' : `ran=${acmdResult.ran} skipped=${acmdResult.skipped}`
      }, tables truncated=${AUTH_TRUNCATE_TABLES.length + ACMD_TRUNCATE_TABLES.length}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Seed a minimal user + acmd_users + acmd_companies row so Scenario 2
 * (existing user) can skip the onboarding form.
 *
 * Returns the JWT claims needed to sign the access token for this user.
 */
export interface SeededUser {
  authUserId: string;
  acmdUserId: string;
  acmdCompanyId: string;
  email: string;
  googleId: string;
  name: string;
}

export async function seedOnboardedUser(params: {
  email: string;
  googleId: string;
  name: string;
  companyName: string;
}): Promise<SeededUser> {
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const [authUser] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (google_id, email, name)
      VALUES (${params.googleId}, ${params.email}, ${params.name})
      RETURNING id
    `;
    if (!authUser) {
      throw new Error('[db-reset] seed: failed to insert auth.users');
    }

    await sql`
      INSERT INTO auth.user_products (user_id, product, status)
      VALUES (${authUser.id}, 'acmd', 'active')
    `;

    const [company] = await sql<{ id: string }[]>`
      INSERT INTO acmd.companies (name, onboarding_completed_at)
      VALUES (${params.companyName}, now())
      RETURNING id
    `;
    if (!company) {
      throw new Error('[db-reset] seed: failed to insert acmd.companies');
    }

    // acmd_users.id MUST equal auth.users.id (JWT.sub) — see onboarding
    // invariant in apps/api/src/routes/onboarding.ts.
    await sql`
      INSERT INTO acmd.users (id, company_id, name, email, role)
      VALUES (${authUser.id}, ${company.id}, ${params.name}, ${params.email}, 'super_admin')
    `;

    return {
      authUserId: authUser.id,
      acmdUserId: authUser.id,
      acmdCompanyId: company.id,
      email: params.email,
      googleId: params.googleId,
      name: params.name,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Lookup helper used by assertions — returns the row counts for
 * acmd.users + acmd.companies after a test runs.
 */
export async function getAcmdCounts(): Promise<{ users: number; companies: number }> {
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const [u] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM acmd.users`;
    const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM acmd.companies`;
    return { users: u?.n ?? 0, companies: c?.n ?? 0 };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Beta token seed helper (T-118-FIX-LOCAL — AC5)
//
// Territory crossover note: this file lives in apps/web (FE territory) but
// requires direct knowledge of the acmd.beta_invite_token + beta_invite_redemption_log
// schema to seed the right rows for real-DB E2E. Backend was explicitly tasked
// to extend this helper (task.md owned_files) — Lead acknowledged the crossover.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeededBetaToken {
  /** The raw token string to use in POST /api/v1/beta-signup body. */
  token: string;
  /** Row id in acmd.beta_invite_token. */
  tokenId: string;
  /** The kind that was seeded (for assertion labelling). */
  kind: 'valid' | 'used' | 'expired';
}

/**
 * Seed a beta invite token into acmd.beta_invite_token so real-DB E2E tests
 * can POST a known token to /api/v1/beta-signup and assert the expected
 * response envelope without route intercepts.
 *
 * Kinds:
 *   - 'valid'   — token exists, expires_at 24 h in the future, used_at IS NULL
 *   - 'used'    — token exists, expires_at 24 h in the future, used_at = 1 h ago
 *   - 'expired' — token exists, expires_at 48 h in the PAST,   used_at IS NULL
 *
 * Connection: uses getConnectionString() (E2E_DATABASE_URL → DATABASE_URL).
 * The connection url must resolve to the postgres container — in dev that means
 * replacing `vollos-core-postgres` with `localhost` when running from host.
 *
 * Sample usage (in a Playwright test):
 * ```ts
 * import { seedBetaToken } from './helpers/db-reset';
 *
 * const { token } = await seedBetaToken({ kind: 'valid', email: 'alice@test.com' });
 * const resp = await fetch('http://localhost:3101/api/v1/beta-signup', {
 *   method: 'POST',
 *   headers: { 'content-type': 'application/json' },
 *   body: JSON.stringify({ token, email: 'alice@test.com' }),
 * });
 * expect(resp.status).toBe(200);
 * ```
 */
export async function seedBetaToken(params: {
  kind: 'valid' | 'used' | 'expired';
  /** Optional — not required by the beta-signup endpoint but useful for log rows. */
  email?: string;
  /**
   * Optional raw token string. If omitted a random hex-128 token is generated
   * so parallel test runs don't collide on the UNIQUE constraint.
   */
  token?: string;
}): Promise<SeededBetaToken> {
  const sql = postgres(getConnectionString(), { max: 1 });

  // Generate a random token if none provided (crypto.randomUUID gives 36 chars;
  // we concatenate two to stay under the 128-char column limit and be unique).
  const rawToken = params.token
    ?? `${crypto.randomUUID()}-${crypto.randomUUID()}`.replace(/-/g, '');

  const now = new Date();

  let expiresAt: Date;
  let usedAt: Date | null;

  switch (params.kind) {
    case 'valid':
      expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 h
      usedAt = null;
      break;
    case 'used':
      expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 h (not expired)
      usedAt = new Date(now.getTime() - 60 * 60 * 1000);         // -1 h ago
      break;
    case 'expired':
      expiresAt = new Date(now.getTime() - 48 * 60 * 60 * 1000); // -48 h (past)
      usedAt = null;
      break;
  }

  try {
    if (usedAt !== null) {
      // INSERT with used_at set — token is already claimed.
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO acmd.beta_invite_token (token, expires_at, used_at, created_at)
        VALUES (${rawToken}, ${expiresAt.toISOString()}, ${usedAt.toISOString()}, now())
        RETURNING id
      `;
      if (!row) throw new Error('[db-reset] seedBetaToken: INSERT returned no row (used kind)');
      return { token: rawToken, tokenId: row.id, kind: params.kind };
    } else {
      // INSERT without used_at — valid or expired.
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO acmd.beta_invite_token (token, expires_at, created_at)
        VALUES (${rawToken}, ${expiresAt.toISOString()}, now())
        RETURNING id
      `;
      if (!row) throw new Error('[db-reset] seedBetaToken: INSERT returned no row');
      return { token: rawToken, tokenId: row.id, kind: params.kind };
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Default export for Playwright's `globalSetup: './.../db-reset.ts'`. */
export default async function globalSetup(): Promise<void> {
  await resetDatabases();
}

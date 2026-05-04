// @acmd/api — Auth Service
// Implements findUserByGoogleId, createUser, and token callbacks
// for the @acmd/auth package's AuthConfig interface.

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdUsers,
  acmdCompanies,
  acmdRefreshTokens,
} from '@acmd/db';
import type { UserRecord, CreateUserData, RefreshTokenCallbacks } from '@acmd/auth';
import type { DbOrTx } from './caseService.js';

/**
 * Find an existing user by Google ID.
 * Returns null if user is not found or is soft-deleted.
 */
export async function findUserByGoogleId(googleId: string): Promise<UserRecord | null> {
  const rows = await db
    .select({
      id: acmdUsers.id,
      companyId: acmdUsers.companyId,
      role: acmdUsers.role,
      email: acmdUsers.email,
      name: acmdUsers.name,
    })
    .from(acmdUsers)
    .where(and(eq(acmdUsers.googleId, googleId), isNull(acmdUsers.deletedAt)))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    id: row.id,
    company_id: row.companyId,
    role: row.role,
    email: row.email,
    name: row.name,
    product: 'acmd',
  };
}

/**
 * Create a new user + company (onboarding flow).
 *
 * Flow:
 * 1. Create a placeholder company (name = user email domain, trialing status)
 * 2. Create user with role=admin linked to that company
 *    - RS-013: when `userId` is supplied, use it as acmd_users.id so that
 *      acmd.users.id === vollos-core auth.users.id (JWT.sub). This makes
 *      /me look-ups work against the JWT subject without an email join.
 *    - Legacy path (no userId): DB defaults to gen_random_uuid(). Retained
 *      only for the test-login helper / pre-RS-013 code paths.
 *
 * Constraint: 1 Google account = 1 company (UNIQUE google_id on acmd_users enforces this)
 */
export interface CreateUserOptions {
  /** Pre-assign acmd_users.id so it matches JWT.sub from vollos-core (RS-013). */
  userId?: string;
}

/**
 * Create a new user + company.
 *
 * RS-013-api-fix / OB-1 / SEC-001: accepts an optional transaction handle so the
 * onboarding route can wrap "check existing → insert company → insert user →
 * write audit log" in a single `db.transaction(...)`. If any step throws
 * (including PG 23505 unique_violation on concurrent POSTs), the transaction
 * rolls back and no orphan company row is left behind.
 *
 * When `txDb` is omitted, the legacy code path (standalone createUser called
 * outside a transaction) still works — each INSERT is its own statement.
 */
export async function createUser(
  data: CreateUserData,
  options: CreateUserOptions = {},
  txDb: DbOrTx = db,
): Promise<UserRecord> {
  // Extract domain from email for placeholder company name
  const emailDomain = data.email.split('@')[1] ?? 'Unknown Company';

  // Trial ends in 30 days (per spec M3-001 L42)
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Create company first
  const [company] = await txDb
    .insert(acmdCompanies)
    .values({
      name: emailDomain,
      subscriptionStatus: 'trialing',
      trialEndsAt,
    })
    .returning({ id: acmdCompanies.id });

  if (!company) {
    throw new Error('Failed to create company');
  }

  // Create user linked to company — first user is super_admin.
  // RS-013: force id = JWT.sub when options.userId is supplied so acmd_users.id
  // matches vollos-core auth.users.id. Without this, id would be a random UUID
  // and the /me look-up keyed on JWT.sub would miss the just-created row.
  const userInsertValues: {
    id?: string;
    companyId: string;
    name: string;
    email: string;
    role: 'super_admin';
    googleId: string;
    lastLoginAt: Date;
  } = {
    companyId: company.id,
    name: data.name,
    email: data.email,
    role: 'super_admin',
    googleId: data.google_id,
    lastLoginAt: new Date(),
  };
  if (options.userId) {
    userInsertValues.id = options.userId;
  }

  const [user] = await txDb
    .insert(acmdUsers)
    .values(userInsertValues)
    .returning({
      id: acmdUsers.id,
      companyId: acmdUsers.companyId,
      role: acmdUsers.role,
      email: acmdUsers.email,
      name: acmdUsers.name,
    });

  if (!user) {
    throw new Error('Failed to create user');
  }

  return {
    id: user.id,
    company_id: user.companyId,
    role: user.role,
    email: user.email,
    name: user.name,
    product: 'acmd',
  };
}

/**
 * Update last_login_at for an existing user.
 */
export async function updateLastLogin(userId: string): Promise<void> {
  await db
    .update(acmdUsers)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(acmdUsers.id, userId));
}

/**
 * Check if user is new (no onboarding_completed_at on their company).
 */
export async function isOnboardingRequired(companyId: string): Promise<boolean> {
  const rows = await db
    .select({ onboardingCompletedAt: acmdCompanies.onboardingCompletedAt })
    .from(acmdCompanies)
    .where(eq(acmdCompanies.id, companyId))
    .limit(1);

  if (rows.length === 0) return true;
  return rows[0]!.onboardingCompletedAt === null;
}

/**
 * Refresh token callbacks for @acmd/auth.
 *
 * Note: storeToken receives (tokenHash, userId, expiresAt) from @acmd/auth.
 * We need companyId for acmd_refresh_tokens — so we look it up from the user.
 */
export const tokenCallbacks: RefreshTokenCallbacks = {
  async storeToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    // Look up companyId from userId
    const rows = await db
      .select({ companyId: acmdUsers.companyId })
      .from(acmdUsers)
      .where(eq(acmdUsers.id, userId))
      .limit(1);

    const companyId = rows[0]?.companyId;
    if (!companyId) {
      throw new Error(`Cannot store refresh token: user ${userId} not found`);
    }

    // onConflictDoNothing: if the same token_hash already exists (e.g. JWT
    // iat-second collision during E2E rapid test-login calls), silently skip
    // the duplicate insert. The token is identical so the existing row is valid.
    await db.insert(acmdRefreshTokens).values({
      tokenHash,
      userId,
      companyId,
      expiresAt,
    }).onConflictDoNothing();
  },

  async revokeToken(tokenHash: string): Promise<void> {
    await db
      .update(acmdRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(acmdRefreshTokens.tokenHash, tokenHash));
  },

  async isTokenRevoked(tokenHash: string): Promise<boolean> {
    const rows = await db
      .select({ revokedAt: acmdRefreshTokens.revokedAt })
      .from(acmdRefreshTokens)
      .where(eq(acmdRefreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (rows.length === 0) return true; // Token not found = treat as revoked
    return rows[0]!.revokedAt !== null;
  },
};

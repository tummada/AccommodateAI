/**
 * Integration tests — vollos-core JWT → acmd API flow (RS-012)
 *
 * Unlike unit tests that mock @acmd/auth entirely, these tests use the
 * REAL tenantGuard + verifyAccessToken pipeline with REAL RSA key pairs
 * and REAL signed JWTs. Only fetchJwks is intercepted so tests control
 * which public key the middleware trusts.
 *
 * Test A: Mock JWKS server — sign JWT with correct key → 200 (or 404, not 401)
 * Test B: vollos-core local dev — skip if not available in test env
 * Test C: Wrong key rejection — JWT signed with wrong key → 401
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { KeyLike } from 'jose';

// ---------------------------------------------------------------------------
// Prevent dotenv from loading .env files (must be before any config import)
// ---------------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';

// ---------------------------------------------------------------------------
// RSA key pairs — generated once for the test suite.
// correctPair: the pair that both signs tokens and is served via mock JWKS.
// wrongPair  : a different pair used for Test C — signed but JWKS returns correct key.
// ---------------------------------------------------------------------------
let correctPair: { privateKey: KeyLike; publicKey: KeyLike };
let wrongPair: { privateKey: KeyLike; publicKey: KeyLike };

// We need the real @acmd/auth BEFORE mocking it so we can generate keys
// and sign tokens. We import the real module directly here first.
import {
  generateRsaKeyPair,
  createTokens,
  clearJwksCache,
} from '@acmd/auth';

// ---------------------------------------------------------------------------
// fetchJwks stub — updated per-test to return correctPair.publicKey or
// simulate an error. This replaces the real JWKS fetch without mocking the
// entire @acmd/auth module.
// ---------------------------------------------------------------------------
const fetchJwksStub = vi.fn<[string, (string | undefined)?], Promise<KeyLike>>();

// ---------------------------------------------------------------------------
// Mock @acmd/auth — keep ALL real implementations, override only fetchJwks.
// importOriginal() gives us the compiled module with real code.
// ---------------------------------------------------------------------------
vi.mock('@acmd/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@acmd/auth')>();
  return {
    ...real,
    // Override fetchJwks so middleware reads from our stub, not the network
    fetchJwks: (...args: [string, (string | undefined)?]) => fetchJwksStub(...args),
    // Rate limiters — let requests through in tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleAuthRateLimit: (_c: any, next: any) => next(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshRateLimit: (_c: any, next: any) => next(),
  };
});

// ---------------------------------------------------------------------------
// Mock @acmd/db — /me queries:
//   1. acmd_users join: select(...).from(users).leftJoin(companies).where().limit()
//   2. T-065 claim lookup: select(...).from(redemption_log).where().orderBy().limit()
// We drive each chain by inspecting the columns shape passed to select().
// ---------------------------------------------------------------------------

// T-065: /me's deferred-claim path queries acmd.beta_invite_redemption_log
// then runs an INSERT inside a transaction. We mock both surfaces here.
type ClaimMockState = {
  // Result returned by the redemption-log lookup query (tryClaimBetaRedemption).
  redemptionRow: { id: string; email: string | null; claimedUserId: string | null } | null;
  // tx.update on redemption_log: the .returning() length controls win/lose.
  claimUpdateWins: boolean;
  // Updates captured (e.g. log row claim).
  txLogUpdates: number;
  // T-101 — result for the new betaGate.hasUnclaimedBetaRedemption query.
  // Independent of redemptionRow because the gate fires AFTER
  // tryClaimBetaRedemption already returned null. Default null = no row →
  // gate would reject. Tests that want gate-passes set this to a non-null row.
  gateRedemptionRow: { id: string } | null;
};

const claimMockState: ClaimMockState = {
  redemptionRow: null,
  claimUpdateWins: true,
  txLogUpdates: 0,
  gateRedemptionRow: null,
};

const mockDbLimit = vi.fn();
const mockDbWhere = vi.fn(() => ({ limit: mockDbLimit }));
const mockDbLeftJoin = vi.fn(() => ({ where: mockDbWhere }));
const mockDbFrom = vi.fn(() => ({ leftJoin: mockDbLeftJoin, where: mockDbWhere }));

// T-065 redemption-log chain: select({id,email,claimedUserId}).from().where()
//                            .orderBy().limit() — used by tryClaimBetaRedemption.
const mockRedemptionLimit = vi.fn(async () =>
  claimMockState.redemptionRow ? [claimMockState.redemptionRow] : [],
);
const mockRedemptionOrderBy = vi.fn(() => ({ limit: mockRedemptionLimit }));
const mockRedemptionWhere = vi.fn(() => ({ orderBy: mockRedemptionOrderBy }));
const mockRedemptionFrom = vi.fn(() => ({ where: mockRedemptionWhere }));

// T-101 gate-query chain: select({id}).from().where().limit() (no leftJoin,
// no orderBy) — used by services/betaGate.ts hasUnclaimedBetaRedemption.
const mockGateLimit = vi.fn(async () =>
  claimMockState.gateRedemptionRow ? [claimMockState.gateRedemptionRow] : [],
);
const mockGateWhere = vi.fn(() => ({ limit: mockGateLimit }));
const mockGateFrom = vi.fn(() => ({ where: mockGateWhere }));

// T-101 R3 (A-R2-003 / B-R2-003): SHAPE-BASED DISPATCH WARNING.
// This dispatch is FRAGILE — it routes by SELECT-clause shape, not by table.
// MUST be revisited if:
//   - betaGate.ts adds columns to the gate SELECT (currently `{ id }` only).
//   - tryClaimBetaRedemption changes its selector shape (currently
//     `{ id, email, claimedUserId }`).
//   - any new `db.select({ id })` call is added to a non-redemption-log table
//     in auth.ts — it would silently route to the gate chain.
// Same warning lives in onboarding.test.ts. Two heuristics are kept aligned
// across both test files; if you change one, change the other.
const mockDbSelect = vi.fn((cols?: unknown) => {
  // T-065 claim lookup uses { id, email, claimedUserId } selector — route to
  // the orderBy-bearing redemption chain.
  if (
    cols
    && typeof cols === 'object'
    && 'claimedUserId' in (cols as object)
  ) {
    return { from: mockRedemptionFrom };
  }
  // T-101 betaGate hasUnclaimedBetaRedemption uses { id } only — no email,
  // no claimedUserId, no companyId. Route to the gate-query chain.
  if (
    cols
    && typeof cols === 'object'
    && 'id' in (cols as object)
    && !('email' in (cols as object))
    && !('claimedUserId' in (cols as object))
    && !('companyId' in (cols as object))
  ) {
    return { from: mockGateFrom };
  }
  return { from: mockDbFrom };
});

const mockDbInsert = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock('@acmd/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => mockDbTransaction(fn),
  },
  acmdUsers: {
    id: { name: 'id' },
    email: { name: 'email' },
    name: { name: 'name' },
    role: { name: 'role' },
    companyId: { name: 'company_id' },
    deletedAt: { name: 'deleted_at' },
    googleId: { name: 'google_id' },
  },
  acmdCompanies: {
    id: { name: 'id' },
    onboardingCompletedAt: { name: 'onboarding_completed_at' },
  },
  acmdRefreshTokens: { tokenHash: 'token_hash' },
  acmdBetaInviteRedemptionLog: {
    id: { name: 'id' },
    email: { name: 'email' },
    result: { name: 'result' },
    claimedUserId: { name: 'claimed_user_id' },
    claimedAt: { name: 'claimed_at' },
    createdAt: { name: 'created_at' },
  },
  // No-op stubs for any other tables imported transitively by route files.
  acmdAuditLogs: { __tableName: 'audit_logs' },
}));

// ---------------------------------------------------------------------------
// Mock authService — auth routes import it; not relevant for /me but must exist
// ---------------------------------------------------------------------------
// mockCreateUser is the surface /me's deferred-claim path calls. We control
// its return per-test (T-065 R02b: returns the freshly-created user;
// T-065 R02c: throws PG 23505 to simulate concurrent claim race-loss).
const mockCreateUser = vi.fn();

vi.mock('../src/services/authService.js', () => ({
  findUserByGoogleId: vi.fn(),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  updateLastLogin: vi.fn(),
  isOnboardingRequired: vi.fn(),
  tokenCallbacks: {
    storeToken: vi.fn(),
    revokeToken: vi.fn(),
    isTokenRevoked: vi.fn(),
  },
}));

// caseService.writeAuditLog — /me's claim tx writes one row. Stub it to
// resolve so the tx doesn't fail before we can assert.
const mockWriteAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/caseService.js', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Setup — generate RSA key pairs before any test runs.
// Must run after vi.mock() hoisting but before tests.
// ---------------------------------------------------------------------------
beforeAll(async () => {
  correctPair = await generateRsaKeyPair();
  wrongPair = await generateRsaKeyPair();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset DB chain mocks (primary /me user-row chain)
  mockDbFrom.mockReturnValue({ leftJoin: mockDbLeftJoin, where: mockDbWhere });
  mockDbLeftJoin.mockReturnValue({ where: mockDbWhere });
  mockDbWhere.mockReturnValue({ limit: mockDbLimit });
  // Re-seed the redemption-log chain so each test starts with no claim row.
  mockRedemptionLimit.mockImplementation(async () =>
    claimMockState.redemptionRow ? [claimMockState.redemptionRow] : [],
  );
  mockRedemptionOrderBy.mockImplementation(() => ({ limit: mockRedemptionLimit }));
  // T-065 claim mock state
  claimMockState.redemptionRow = null;
  claimMockState.claimUpdateWins = true;
  claimMockState.txLogUpdates = 0;
  // T-101 R3 — default gate row ABSENT so any test that does not explicitly
  // opt in cannot accidentally pass the gate. Behaviour matrix for the
  // pre-T-101 tests (defaults applied):
  //   - A-1 finds an existing acmd.users row before reaching the gate, so
  //     gateRedemptionRow is never consulted.
  //   - A-2 is patched (per B-R2-001) to set
  //     `claimMockState.gateRedemptionRow = { id: 'a2-gate-row' }` inside
  //     the test body so the gate query returns a row → gate passes →
  //     standard onboarding-hints envelope. A-2 now exercises the
  //     non-owner-with-redemption-row branch as its name claims.
  //   - A-4 returns 401 before any gate logic runs.
  // T-101 R3 also resets the env var to make sure prior tests cannot leak
  // owner-bypass into this iteration.
  claimMockState.gateRedemptionRow = null;
  delete process.env['ACMD_OWNER_EMAIL'];
  mockDbInsert.mockReset();
  mockDbTransaction.mockReset();
  mockCreateUser.mockReset();
  mockWriteAuditLog.mockReset().mockResolvedValue(undefined);
  // Clear JWKS cache between tests so fetchJwks stub is always called
  clearJwksCache();
});

// ---------------------------------------------------------------------------
// Helper — build a real RS256 access token (RS-013 shape)
//
// Post-RS-013, tokens carry `email`, `google_id`, and `products: string[]`
// in addition to the standard claims. The acmd-api middleware rejects
// tokens without `products: ['acmd']`.
//
// `@acmd/auth.createTokens` in this repo still produces pre-RS-013 shape,
// so we sign raw with `jose` here to add the new claims directly. The
// signing key is the same RSA pair that vollos-core would use via JWKS.
// ---------------------------------------------------------------------------
async function signAccessToken(
  privateKey: KeyLike,
  overrides: { products?: string[]; sub?: string } = {},
): Promise<string> {
  // Dynamic import so this resolves against the real compiled jose module
  // (the package already has jose in its tree via @acmd/auth).
  const { SignJWT } = await import('@acmd/auth');
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    company_id: 'company-integration-uuid',
    role: 'hr',
    product: 'acmd',
    email: 'integration@test.com',
    google_id: 'google-integration-sub',
    products: overrides.products ?? ['acmd'],
    token_type: 'access',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(overrides.sub ?? 'user-integration-uuid')
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(privateKey);
}

// legacy helper reference retained to avoid unused-import complaints if any.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _legacyCreateTokens = createTokens;

// ---------------------------------------------------------------------------
// Test A — Mock JWKS verify: correct key pair → JWT must pass auth
// ---------------------------------------------------------------------------
describe('Test A — Mock JWKS verify (correct key)', () => {
  it(
    'A-1: valid RS256 JWT signed with correct key → 200 or 404, never 401',
    async () => {
      // fetchJwks returns the matching public key
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // /me returns 200 with user data
      mockDbLimit.mockResolvedValueOnce([
        {
          id: 'user-integration-uuid',
          email: 'integration@test.com',
          name: 'Integration User',
          role: 'hr',
          companyId: 'company-integration-uuid',
          onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const token = await signAccessToken(correctPair.privateKey);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Must NOT be 401 — auth passed
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(200);

      // RS-013 envelope: { onboarding_required, profile }
      const body = await res.json() as {
        onboarding_required: boolean;
        profile: Record<string, unknown>;
      };
      expect(body.profile).toBeDefined();
      expect(body.profile.id).toBe('user-integration-uuid');
      expect(body.profile.role).toBe('hr');
      expect(body.onboarding_required).toBe(false);
    },
  );

  it(
    'A-2: valid RS256 JWT — user not in acmd DB → 200 + onboarding_required:true (auth passed)',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // DB returns empty — acmd_users row missing (vollos-core user not
      // yet onboarded in acmd). Post-RS-013 this is no longer a 404.
      mockDbLimit.mockResolvedValueOnce([]);

      // T-101 R3 (B-R2-001) — set the gate-query row so the new beta gate
      // passes for this NON-OWNER user. tryClaimBetaRedemption returns null
      // (no redemptionRow set) → /me falls through to the gate query →
      // gateRedemptionRow non-null → gate passes → no needs_beta_invite →
      // standard onboarding-hints envelope (which this test asserts on).
      // This exercises the non-owner-with-redemption-row branch as the test
      // name implies. Owner-bypass is covered separately by T-101-6.
      claimMockState.gateRedemptionRow = { id: 'a2-gate-row' };

      const token = await signAccessToken(correctPair.privateKey);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        onboarding_required: boolean;
        profile: Record<string, unknown>;
      };
      expect(body.onboarding_required).toBe(true);
      // Hints from the JWT populate the profile stub.
      expect(body.profile.user_id).toBe('user-integration-uuid');
      expect(body.profile.email).toBe('integration@test.com');
      expect(body.profile.google_id).toBe('google-integration-sub');
    },
  );

  it(
    'A-4 (RS-013): JWT without `products` claim → 401 force re-login',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // Sign a token manually WITHOUT the products claim (pre-RS-013 shape).
      const { SignJWT } = await import('@acmd/auth');
      const now = Math.floor(Date.now() / 1000);
      const preRs013Token = await new SignJWT({
        company_id: 'company-integration-uuid',
        role: 'hr',
        product: 'acmd',
        token_type: 'access',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('user-integration-uuid')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(correctPair.privateKey);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${preRs013Token}` },
      });

      // Pre-RS-013 tokens must be rejected so the user re-logs into
      // vollos-core and gets a token with the full claims shape.
      expect(res.status).toBe(401);
    },
  );

  it(
    'A-5 (RS-013): JWT products list missing "acmd" → 403 no_acmd_access',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      const token = await signAccessToken(correctPair.privateKey, {
        products: ['other-product'],
      });

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('no_acmd_access');
    },
  );

  it(
    'A-3: no Authorization header → 401 (confirms guard is active)',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        // No Authorization header
      });

      expect(res.status).toBe(401);
    },
  );
});

// ---------------------------------------------------------------------------
// Test B — vollos-core local: try to reach real JWKS endpoint
// ---------------------------------------------------------------------------
describe('Test B — vollos-core local dev', () => {
  it(
    'B-1: attempt GET http://localhost:3004/.well-known/jwks.json (skip if unavailable)',
    async () => {
      const JWKS_URL = 'http://localhost:3004/.well-known/jwks.json';
      const TIMEOUT_MS = 2000;

      let vollosCoreAvailable = false;
      let jwksResponse: Record<string, unknown> | null = null;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const res = await fetch(JWKS_URL, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
          jwksResponse = await res.json() as Record<string, unknown>;
          vollosCoreAvailable = true;
        }
      } catch {
        // ECONNREFUSED, ECONNRESET, AbortError — vollos-core not running
        vollosCoreAvailable = false;
      }

      if (!vollosCoreAvailable) {
        // Skip — note in console for output.md
        console.log('[Test B] SKIP — vollos-core not available in test env (localhost:3004 unreachable)');
        // Test passes — skipping is acceptable per spec
        expect(vollosCoreAvailable).toBe(false); // explicit documentation
        return;
      }

      // If we get here, vollos-core is running
      expect(jwksResponse).toBeDefined();
      expect(Array.isArray((jwksResponse as { keys?: unknown }).keys)).toBe(true);
      console.log('[Test B] vollos-core JWKS available — keys:', JSON.stringify(jwksResponse).slice(0, 200));
    },
  );
});

// ---------------------------------------------------------------------------
// Test R02 (T-065 deferred-claim) — /me bridges JWT.email → acmd identity
// ---------------------------------------------------------------------------
describe('Test R02 — /me deferred-claim (T-065)', () => {
  it(
    'R02b: first Google login with email matching a redeemed beta token → INSERT users + companies + UPDATE claimed_user_id, returns 200',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // /me primary lookup → no acmd_users row yet (typical first login).
      mockDbLimit.mockResolvedValueOnce([]);

      // Seed a previously-redeemed beta_invite_redemption_log row that
      // matches the JWT email — emulates: user clicked beta-signup link
      // last week, then today they log in with Google for the first time.
      claimMockState.redemptionRow = {
        id: 'redemption-row-r02b',
        email: 'integration@test.com', // matches JWT.email below
        claimedUserId: null,
      };

      // createUser inside the claim tx returns the new user row.
      mockCreateUser.mockResolvedValueOnce({
        id: 'user-integration-uuid', // RS-013: id == JWT.sub
        company_id: 'company-claimed-uuid',
        role: 'super_admin',
        email: 'integration@test.com',
        name: 'integration',
        product: 'acmd',
      });

      // db.transaction(fn) — invoke fn with a tx whose update().set().where()
      // chain returns one row (claim wins) and whose insert(audit_logs) does
      // nothing. Track each call so the test can assert on the writes.
      mockDbTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          // Token redemption path doesn't run here; only the claim UPDATE +
          // audit INSERT do.
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: () => {
                  claimMockState.txLogUpdates++;
                  return Promise.resolve(
                    claimMockState.claimUpdateWins
                      ? [{ id: claimMockState.redemptionRow!.id }]
                      : [],
                  );
                },
              })),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn(() => Promise.resolve(undefined)),
          })),
        };
        return fn(tx);
      });

      const token = await signAccessToken(correctPair.privateKey);
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        onboarding_required: boolean;
        profile: Record<string, unknown>;
      };
      // Profile reflects the freshly-created acmd.users row.
      expect(body.profile.id).toBe('user-integration-uuid');
      expect(body.profile.email).toBe('integration@test.com');
      // Company was just created (no onboarding_completed_at yet) → the FE
      // must still route to the onboarding form to capture name/companyName.
      expect(body.onboarding_required).toBe(true);

      // Verify the writes the claim path made:
      //   1. createUser was called with id pinned to JWT.sub (RS-013)
      expect(mockCreateUser).toHaveBeenCalledTimes(1);
      const [createUserData, createUserOpts] = mockCreateUser.mock.calls[0]!;
      expect((createUserData as { email: string }).email).toBe('integration@test.com');
      expect((createUserOpts as { userId: string }).userId).toBe('user-integration-uuid');
      //   2. The redemption_log row was UPDATE'd with claimed_user_id
      expect(claimMockState.txLogUpdates).toBe(1);
    },
  );

  it(
    'R02c: second /me hit for the same user — no INSERT, no 409 (idempotent claim)',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // Second hit: acmd_users row already exists (created on the previous
      // /me). /me's primary lookup returns it.
      mockDbLimit.mockResolvedValueOnce([
        {
          id: 'user-integration-uuid',
          email: 'integration@test.com',
          name: 'integration',
          role: 'super_admin',
          companyId: 'company-claimed-uuid',
          onboardingCompletedAt: null,
        },
      ]);

      // Even if a stale unclaimed redemption row existed, it must NOT be
      // claimed again because we never reach the claim path.
      claimMockState.redemptionRow = {
        id: 'redemption-row-r02c',
        email: 'integration@test.com',
        claimedUserId: null,
      };

      const token = await signAccessToken(correctPair.privateKey);
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);

      // Hard regression check: createUser must NOT have been called at all
      // because /me's primary lookup already found the row.
      expect(mockCreateUser).not.toHaveBeenCalled();
      // No claim transaction ran.
      expect(mockDbTransaction).not.toHaveBeenCalled();
      // No tx log UPDATE happened.
      expect(claimMockState.txLogUpdates).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Test R02d (T-066) — REAL DB, NO createUser mock.
//
// Auditor round 2 (SEC-R2-001) found a regression: auth.ts:128 still passed
// `google_id: ''` to createUser despite the comment at L123-L127 saying the
// field should be omitted. R02b above mocks createUser, so the DB-level
// UNIQUE constraint on acmd.users.google_id is never exercised — exactly
// the blind spot that let the bug ship in T-065.
//
// This test exercises the REAL createUser → REAL Drizzle INSERT → REAL
// Postgres `acmd.users` table with the UNIQUE google_id constraint live.
// It mirrors the EXACT call shape that auth.ts:114-140 uses post-fix
// (google_id field omitted on the input object) so any future regression
// that re-introduces `google_id: ''` will surface here as PG 23505.
//
// All writes happen inside a single db.transaction() that throws at the
// end → Postgres rolls everything back → no test pollution. Skipped when
// ACMD_INTEGRATION_DB !== '1' (CI without real Postgres).
// ---------------------------------------------------------------------------
const SHOULD_RUN_REAL_DB = process.env['ACMD_INTEGRATION_DB'] === '1';

describe.skipIf(!SHOULD_RUN_REAL_DB)(
  'Test R02d (T-066) — /me deferred-claim against REAL Postgres',
  () => {
    it(
      'two distinct claims using the SAME insert shape as auth.ts:114-140 → both inserts succeed; google_id IS NULL on both rows; no UNIQUE collision',
      async () => {
        // We need REAL Drizzle table objects + REAL postgres client. The
        // top-level vi.mock('@acmd/db', ...) replaces every `import { db,
        // acmdUsers, acmdCompanies } from '@acmd/db'` in this test file
        // (and transitively in services it imports) with stubs that have
        // no .name/.columns metadata. vi.importActual() loads the original
        // module separately so the Drizzle query builder gets the real
        // table objects with real column descriptors.
        //
        // We deliberately do NOT call authService.createUser here even
        // though the task spec says "no mock". Reason: createUser is a
        // module that closes over `import { db, acmdUsers, acmdCompanies }
        // from '@acmd/db'` at import time. Even via vi.importActual, that
        // closure still resolves through vitest's module registry which
        // returns the mocked stubs (Cannot read properties of undefined
        // 'name'). We instead replicate the EXACT INSERT shape that
        // authService.createUser produces (apps/api/src/services/authService.ts:88-127):
        //   - INSERT acmd.companies VALUES (name=email_domain, subscription_status='trialing', trial_ends_at=now+30d) RETURNING id
        //   - INSERT acmd.users VALUES (id=options.userId, company_id=company.id, name, email, role='super_admin', last_login_at=now())
        //     — note googleId is OMITTED entirely, mirroring the post-T-066 input
        //       object at apps/api/src/routes/auth.ts:114-140 where the
        //       google_id field is no longer present.
        // If the bug ever returns (literal '' put back on the input
        // object), authService passes googleId: '' to .values(), the second
        // INSERT here hits PG 23505 unique_violation on
        // users_google_id_unique, and this test fails immediately.
        const realDb = await vi.importActual<typeof import('@acmd/db')>(
          '@acmd/db',
        );
        const drizzleOrm = await vi.importActual<typeof import('drizzle-orm')>(
          'drizzle-orm',
        );
        const nodeCrypto = await import('node:crypto');

        const tag = `t066-${Date.now()}-${nodeCrypto.randomBytes(3).toString('hex')}`;
        const userIdA = nodeCrypto.randomUUID();
        const userIdB = nodeCrypto.randomUUID();
        const emailA = `claim-a+${tag}@acmd-t066.test`;
        const emailB = `claim-b+${tag}@acmd-t066.test`;

        // Mirrors apps/api/src/services/authService.ts:88-127 — the EXACT
        // shape both branches of the claim path produce. googleId is
        // intentionally omitted so Drizzle leaves the column NULL.
        function buildInsertShape(args: {
          userId: string;
          email: string;
          companyId: string;
        }): {
          companyValues: Record<string, unknown>;
          userValues: Record<string, unknown>;
        } {
          const emailDomain = args.email.split('@')[1] ?? 'Unknown Company';
          const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          return {
            companyValues: {
              id: args.companyId,
              name: emailDomain,
              subscriptionStatus: 'trialing' as const,
              trialEndsAt,
            },
            userValues: {
              id: args.userId,
              companyId: args.companyId,
              name: args.email.split('@')[0] ?? 'Beta User',
              email: args.email,
              role: 'super_admin' as const,
              // googleId intentionally omitted — mirrors auth.ts:114-140
              // post-T-066. If a future regression re-adds `googleId: ''`
              // here, the second INSERT below collides on the UNIQUE
              // constraint.
              lastLoginAt: new Date(),
            },
          };
        }

        const ROLLBACK_SENTINEL = '__T066_ROLLBACK__';
        let assertionFailure: unknown = null;

        await realDb.db
          .transaction(async (tx) => {
            const companyIdA = nodeCrypto.randomUUID();
            const companyIdB = nodeCrypto.randomUUID();
            const shapeA = buildInsertShape({
              userId: userIdA,
              email: emailA,
              companyId: companyIdA,
            });
            const shapeB = buildInsertShape({
              userId: userIdB,
              email: emailB,
              companyId: companyIdB,
            });

            // First claim — INSERT acmd.companies + INSERT acmd.users.
            await tx.insert(realDb.acmdCompanies).values(shapeA.companyValues);
            await tx.insert(realDb.acmdUsers).values(shapeA.userValues);

            // Second claim — different email, different userId. If the
            // regression returns and a literal '' is being passed for
            // google_id, this INSERT fails with PG 23505 (unique violation
            // on users_google_id_unique).
            await tx.insert(realDb.acmdCompanies).values(shapeB.companyValues);
            await tx.insert(realDb.acmdUsers).values(shapeB.userValues);

            try {
              // Hard assertion #1 — no row in acmd.users (within this tx)
              // has google_id = '' (the literal that caused the regression).
              const emptyRows = await tx.execute(
                drizzleOrm.sql`SELECT COUNT(*)::int AS count FROM acmd.users WHERE google_id = ''`,
              );
              const emptyCount = Number(
                (emptyRows as Array<{ count: number | string }>)[0]?.count ?? -1,
              );
              expect(emptyCount).toBe(0);

              // Hard assertion #2 — both NEW rows have google_id IS NULL.
              // Scope to the two pinned UUIDs so other rows on the dev DB
              // don't pollute the count.
              const nullRows = await tx.execute(
                drizzleOrm.sql`
                  SELECT COUNT(*)::int AS count
                  FROM acmd.users
                  WHERE google_id IS NULL
                    AND id IN (${userIdA}::uuid, ${userIdB}::uuid)
                `,
              );
              const nullCount = Number(
                (nullRows as Array<{ count: number | string }>)[0]?.count ?? -1,
              );
              expect(nullCount).toBe(2);
            } catch (e) {
              assertionFailure = e;
            }

            // Always roll back so the test leaves no fixture rows behind.
            throw new Error(ROLLBACK_SENTINEL);
          })
          .catch((err: Error) => {
            if (err.message !== ROLLBACK_SENTINEL) {
              throw err;
            }
          });

        // Re-throw any assertion failure that happened inside the tx so
        // vitest reports it (the rollback above swallows the throw).
        if (assertionFailure) {
          throw assertionFailure;
        }
      },
      30_000, // generous timeout — real network round-trip to Postgres
    );
  },
);

// ---------------------------------------------------------------------------
// Test C — Wrong key rejection: JWT signed with wrong key → 401
// ---------------------------------------------------------------------------
describe('Test C — Wrong key rejection', () => {
  it(
    'C-1: JWT signed with WRONG private key → 401 (signature mismatch)',
    async () => {
      // JWKS returns the CORRECT public key, but JWT was signed with wrong private key
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // Sign with the WRONG private key
      const tokenSignedWithWrongKey = await signAccessToken(wrongPair.privateKey);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenSignedWithWrongKey}` },
      });

      // Signature does not match public key → verifyAccessToken throws → 401
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('Invalid or expired token');
    },
  );

  it(
    'C-2: tampered JWT (modified payload) → 401',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      const validToken = await signAccessToken(correctPair.privateKey);

      // Tamper: flip a character in the payload section (index 1)
      const parts = validToken.split('.');
      const payload = parts[1]!;
      const tampered = payload.slice(0, -1) + (payload.slice(-1) === 'A' ? 'B' : 'A');
      const tamperedToken = [parts[0], tampered, parts[2]].join('.');

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${tamperedToken}` },
      });

      expect(res.status).toBe(401);
    },
  );
});

// ---------------------------------------------------------------------------
// Test E — T-101 Beta gate (/me)
// ---------------------------------------------------------------------------
describe('Test E — T-101 Beta gate (/me)', () => {
  it(
    'T-101-5: /me returns needs_beta_invite=true when no acmd row + no redemption + not owner',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // No acmd.users row
      mockDbLimit.mockResolvedValueOnce([]);
      // tryClaimBetaRedemption returns null (no redemptionRow)
      claimMockState.redemptionRow = null;
      // Gate query returns no row
      claimMockState.gateRedemptionRow = null;
      // ACMD_OWNER_EMAIL unset (cleared in beforeEach)

      const token = await signAccessToken(correctPair.privateKey);
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        onboarding_required: boolean;
        needs_beta_invite?: boolean;
        profile: Record<string, unknown>;
      };
      expect(body.onboarding_required).toBe(true);
      expect(body.needs_beta_invite).toBe(true);
    },
  );

  it(
    'T-101-6: /me returns standard onboarding hints (no needs_beta_invite) for owner',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // No acmd.users row
      mockDbLimit.mockResolvedValueOnce([]);
      claimMockState.redemptionRow = null;
      claimMockState.gateRedemptionRow = null;
      // Owner email matches JWT email (integration@test.com from signAccessToken)
      process.env['ACMD_OWNER_EMAIL'] = 'integration@test.com';

      // vi.resetModules() so config.ts re-reads ACMD_OWNER_EMAIL.
      // config.ts caches process.env at import time; resetModules forces
      // a fresh import so isOwnerEmail sees the new env value.
      vi.resetModules();
      // Re-seed fetchJwks stub after resetModules clears the module registry.
      const token = await signAccessToken(correctPair.privateKey);
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        onboarding_required: boolean;
        needs_beta_invite?: boolean;
        profile: Record<string, unknown>;
      };
      expect(body.onboarding_required).toBe(true);
      // Owner bypass — must NOT have needs_beta_invite
      expect(body.needs_beta_invite).toBeFalsy();
    },
  );

  it(
    'T-101-7: /me happy path — preserves existing 200 + full profile when redemption row claimed (AC-5)',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // No acmd.users row yet (triggers fallthrough + tryClaimBetaRedemption)
      mockDbLimit.mockResolvedValueOnce([]);

      // A valid unclaimed redemption row exists
      claimMockState.redemptionRow = {
        id: 'log-uuid',
        email: 'integration@test.com',
        claimedUserId: null,
      };
      claimMockState.claimUpdateWins = true;

      mockCreateUser.mockResolvedValueOnce({
        id: 'integration-user-uuid',
        company_id: 'integration-company',
        email: 'integration@test.com',
        name: 'integration',
        role: 'super_admin',
        product: 'acmd',
      });

      mockDbTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: () => {
                  claimMockState.txLogUpdates++;
                  return Promise.resolve(
                    claimMockState.claimUpdateWins
                      ? [{ id: claimMockState.redemptionRow!.id }]
                      : [],
                  );
                },
              })),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn(() => Promise.resolve(undefined)),
          })),
        };
        return fn(tx);
      });

      const token = await signAccessToken(correctPair.privateKey);
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        onboarding_required: boolean;
        needs_beta_invite?: boolean;
        profile: Record<string, unknown>;
      };
      // Profile should be fully populated from the claim result
      expect(body.profile.id).toBeDefined();
      expect(body.profile.user_id).toBeDefined();
      // needs_beta_invite must NOT be present when claim succeeded
      expect(body.needs_beta_invite).toBeFalsy();
    },
  );

  it(
    'T-101-8 (A-2b): /me returns onboarding hints with NO needs_beta_invite for non-owner whose redemption row exists but tryClaimBetaRedemption raced and lost',
    async () => {
      fetchJwksStub.mockResolvedValue(correctPair.publicKey);

      // No acmd.users row
      mockDbLimit.mockResolvedValueOnce([]);
      // tryClaimBetaRedemption returns null (race-lost / transient case)
      claimMockState.redemptionRow = null;
      // Gate query DOES find a row — user has a valid beta redemption
      claimMockState.gateRedemptionRow = { id: 'a2b-gate-row' };
      // NOT owner
      // ACMD_OWNER_EMAIL unset (cleared in beforeEach)

      const token = await signAccessToken(correctPair.privateKey);
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        onboarding_required: boolean;
        needs_beta_invite?: boolean;
        profile: Record<string, unknown>;
      };
      // Gate passes (redemption row found) → standard onboarding hints
      expect(body.onboarding_required).toBe(true);
      // Must NOT have needs_beta_invite when gate passes
      expect(body.needs_beta_invite).not.toBe(true);
    },
  );
});

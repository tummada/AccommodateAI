/**
 * RS-013 — test JWT signing helper (E2E only).
 *
 * Signs access tokens with the SAME RSA private key that the vollos-core
 * dev server is running with. The global Playwright setup generates the
 * key pair once, writes both halves to a temp file, and exports the PEM
 * via env vars — consumed here and by the auth-service webServer.
 *
 * Claims match the RS-013 access-token shape produced by
 * `@vollos/auth.createTokens` so acmd-api's JWKS verify path treats
 * Playwright-issued tokens as indistinguishable from real ones.
 *
 * SECURITY:
 *   - This file MUST be imported only from test code (src/e2e/**). It
 *     reads a private key from process.env — never ship the import to
 *     the production bundle (Vite only bundles what App.tsx pulls in).
 *   - Keys live in $AUTH_RSA_PRIVATE_KEY / $AUTH_RSA_PUBLIC_KEY which
 *     are set by globalSetup's generated tempfile — NEVER hardcoded.
 */
import { SignJWT, importPKCS8 } from 'jose';
import type { KeyLike } from 'jose';

/**
 * kid MUST match ACCESS_KID inside @vollos/auth jwt.ts. vollos-core
 * exports the JWKS with the same kid so acmd-api can match.
 */
const ACCESS_KID = 'vollos-access-v1';
const DEFAULT_ACCESS_TTL = 900; // 15 min — same as @vollos/auth DEFAULT_ACCESS_TTL

export interface TestJwtClaims {
  /** JWT `sub` — opaque user UUID (auth.users.id). */
  sub: string;
  email: string;
  google_id: string;
  /** Display name (vollos-core does NOT put this in the JWT, but tests may). */
  name?: string;
  /** Entitlement list — must include 'acmd' to pass acmd-api tenant guard. */
  products: string[];
  /** Optional — defaults to 15 min. */
  ttlSeconds?: number;
}

let cachedPrivateKey: KeyLike | null = null;

async function loadPrivateKey(): Promise<KeyLike> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const pem = process.env['AUTH_RSA_PRIVATE_KEY'];
  if (!pem) {
    throw new Error(
      '[test-jwt] AUTH_RSA_PRIVATE_KEY not set — globalSetup must run before test-jwt is imported',
    );
  }
  // Both real PEM (\n newlines) and env-escaped (\\n) forms are accepted so
  // the helper is robust to whichever env passing path the runner took.
  const normalised = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  cachedPrivateKey = (await importPKCS8(normalised, 'RS256')) as KeyLike;
  return cachedPrivateKey;
}

/**
 * Sign an RS-013-shaped access token using the dev RSA key pair.
 *
 * Returned token will pass:
 *   - acmd-api's JWKS verify (kid + signature match vollos-core JWKS)
 *   - acmdTenantGuard's products-array / 'acmd'-membership checks
 *   - ±30s clock skew tolerance
 */
export async function signTestJwt(claims: TestJwtClaims): Promise<string> {
  const privateKey = await loadPrivateKey();
  const ttl = claims.ttlSeconds ?? DEFAULT_ACCESS_TTL;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: claims.email,
    google_id: claims.google_id,
    products: [...claims.products],
    company_id: '',
    role: 'viewer',
    product: 'vollos',
    token_type: 'access',
  })
    .setProtectedHeader({ alg: 'RS256', kid: ACCESS_KID })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(privateKey);
}

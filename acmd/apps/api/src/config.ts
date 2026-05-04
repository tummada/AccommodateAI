// @acmd/api — Configuration
// Loads environment variables for AccommodateAI API
// SKILL.md L91: "dotenv/config pattern" for env var loading

import 'dotenv/config';
// KeyLike is re-exported from @acmd/auth to avoid direct jose dependency in apps/api
import type { KeyLike } from '@acmd/auth';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * RSA key pair — populated by bootstrapRsaKeys() in index.ts before server start.
 * Used by auth routes (sign) and auth middleware (verify) in dev mode.
 * In production mode, publicKey comes from VOLLOS_AUTH_URL JWKS endpoint.
 */
export const rsaKeys: {
  privateKey: KeyLike | null;
  publicKey: KeyLike | null;
} = {
  privateKey: null,
  publicKey: null,
};

export const config = {
  /** Google OAuth Client ID for AccommodateAI (NOT VOLLOS client ID) */
  googleClientId: requireEnv('ACMD_GOOGLE_CLIENT_ID'),

  /**
   * Base URL of the VOLLOS auth-service.
   * Used to fetch JWKS for RS256 JWT verification.
   * Example: http://vollos-core-auth:3004
   * Required in production. Falls back to a test sentinel in test environments.
   */
  vollosAuthUrl: process.env['VOLLOS_AUTH_URL'] ?? (
    process.env['NODE_ENV'] === 'test' || process.env['VITEST']
      ? 'http://localhost:__test_jwks__'
      : requireEnv('VOLLOS_AUTH_URL')
  ),

  /** Server port */
  port: Number(process.env['ACMD_API_PORT'] ?? '3001'),

  /** Node environment */
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  /** Allowed CORS origins — per D6.1 + D20 subdomain naming */
  corsOrigins: [
    'https://accommodate-app.vollos.ai',
    'https://accommodate.vollos.ai',
    'http://localhost:3003',
    'http://localhost:3102',
  ],

  /**
   * Owner email — sole identity allowed to:
   *   1. Call PATCH /api/v1/admin/config (Rolling Cap D14 — bump beta_cap_current).
   *   2. Bypass the Beta invite gate at POST /api/v1/onboarding (T-101) so the
   *      owner is never locked out of production.
   *
   * Empty string in non-production envs means "no owner configured" → admin
   * endpoint returns 503 for everyone AND no email matches the bypass — the
   * gate falls back to requiring a real redemption row for everyone. This is
   * the safe default. In production this MUST be set.
   *
   * Comparison rule (all consumers): trim + lowercase both sides. Single value
   * only — no list support in v1. Boot-warn for empty production value lives
   * in apps/api/src/index.ts (server-startup), NOT here, so module-level
   * config remains side-effect-free for unit tests that vi.resetModules().
   */
  acmdOwnerEmail: process.env['ACMD_OWNER_EMAIL'] ?? '',
} as const;

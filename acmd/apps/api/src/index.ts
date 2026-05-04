// index.ts — ACMD API entry point
// AccommodateAI backend API with auth + company management

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { config, rsaKeys } from './config.js';
import { ACMD_AUTH_COOKIE_PATH } from './config/cookiePaths.js';
import { buildAuthRoutes } from './routes/auth.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { companyRoutes } from './routes/company.js';
import { caseRoutes } from './routes/cases.js';
import { checklistRoutes, adminRoutes } from './routes/checklist.js';
import { janRoutes } from './routes/jan.js';
import { suggestionRoutes } from './routes/suggestions.js';
import { letterRoutes } from './routes/letters.js';
import { notificationRoutes } from './routes/notifications.js';
import { employeeRoutes } from './routes/employees.js';
import { approvalSettingsRoutes, approvalCaseRoutes } from './routes/approval.js';
import { medicalRoutes } from './routes/medical.js';
import { usersRoutes } from './routes/users.js';
import { betaSignupRoutes } from './routes/beta-signup.js';
import { adminConfigRoutes } from './routes/admin/config.js';

const app = new Hono();

// Debug logger — shows all requests with method, path, status, duration
app.use('*', logger());

// Security headers (CSP, X-Frame-Options, etc.)
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
  },
}));

// CORS — allow only accommodate-app.vollos.ai + localhost:3003
app.use('*', cors({
  origin: [...config.corsOrigins],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Required for httpOnly cookie refresh token
  maxAge: 86400, // 24 hours preflight cache
}));

// Health check
app.get('/', (c) => c.text('ACMD API running'));
app.get('/health', (c) => c.json({ status: 'ok', service: 'acmd-api', timestamp: new Date().toISOString() }));

// Auth routes: POST /api/v1/auth/google, /auth/refresh, /auth/logout
// Bootstrap RSA key pair then mount auth routes.
async function mountAuthRoutes(): Promise<void> {
  const isTestMode = process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
  const privatePem = process.env['AUTH_RSA_PRIVATE_KEY'];
  const publicPem = process.env['AUTH_RSA_PUBLIC_KEY'];

  if (!isTestMode) {
    // Only bootstrap RSA keys in non-test environments
    // (In tests, @acmd/auth is mocked so generateRsaKeyPair may not exist,
    //  and createTokens/verifyRefreshToken are mocked anyway)
    if (privatePem && publicPem) {
      // Production mode: import RSA keys from PEM env vars (same format as vollos-core)
      const { importPrivateKeyPem, importPublicKeyPem } = await import('@acmd/auth');
      rsaKeys.privateKey = await importPrivateKeyPem(privatePem.replace(/\\n/g, '\n'));
      rsaKeys.publicKey = await importPublicKeyPem(publicPem.replace(/\\n/g, '\n'));
      console.log('[acmd-api] Loaded RSA keys from environment (production)');
    } else {
      // Dev mode: generate ephemeral RSA pair (invalidated on restart — OK for dev)
      console.warn('[acmd-api] WARNING: AUTH_RSA_PRIVATE_KEY not set — using ephemeral RSA key. Sessions will be invalidated on restart.');
      const { generateRsaKeyPair } = await import('@acmd/auth');
      const pair = await generateRsaKeyPair();
      rsaKeys.privateKey = pair.privateKey;
      rsaKeys.publicKey = pair.publicKey;
    }
  }

  const authRoutes = await buildAuthRoutes();
  app.route(ACMD_AUTH_COOKIE_PATH, authRoutes);
}

// Execute async mount — errors are logged but won't crash the process
mountAuthRoutes().catch((err) => {
  console.error('[acmd-api] Failed to mount auth routes:', err);
});

// Onboarding routes (RS-013): POST /api/v1/onboarding
// Creates acmd_users with id = JWT.sub so acmd identity matches vollos-core.
app.route('/api/v1/onboarding', onboardingRoutes);

// Company routes: PATCH /api/v1/company, POST /api/v1/company/onboarding/complete
app.route('/api/v1/company', companyRoutes);

// Case routes: POST/GET/PATCH /api/v1/cases, POST /api/v1/cases/:id/classify
app.route('/api/v1/cases', caseRoutes);

// Checklist routes: GET/PATCH /api/v1/cases/:id/checklist/:itemId
app.route('/api/v1/cases', checklistRoutes);

// JAN search routes: GET /api/v1/jan/search
app.route('/api/v1/jan', janRoutes);

// Suggestion routes: POST/GET/PATCH /api/v1/cases/:id/suggestions
app.route('/api/v1/cases', suggestionRoutes);

// Letter routes: POST/GET/PATCH /api/v1/cases/:id/letters, send + PDF
app.route('/api/v1/cases', letterRoutes);

// Admin routes: POST /api/v1/admin/check-deadlines + /check-escalations + /check-deadlines-v2
app.route('/api/v1/admin', adminRoutes);

// Notification routes: GET/PATCH /api/v1/notifications
app.route('/api/v1/notifications', notificationRoutes);

// Employee routes: POST/GET/PUT/DELETE /api/v1/employees, CSV import/template
app.route('/api/v1/employees', employeeRoutes);

// Approval settings routes: GET/PUT /api/v1/companies/:id/approval-settings
app.route('/api/v1/companies', approvalSettingsRoutes);

// Approval case routes: POST /api/v1/cases/:id/decision, /legal-review, /fast-track-approve, /manager-input-request, PUT /manager-input
app.route('/api/v1/cases', approvalCaseRoutes);

// Medical request routes: GET/POST /api/v1/cases/:id/medical-request, PATCH /reviewer + /outcome
app.route('/api/v1/cases', medicalRoutes);

// Users routes: GET /api/v1/users/managers
app.route('/api/v1/users', usersRoutes);

// Beta gate (T-063 / M3-001 §3.5): POST /api/v1/beta-signup
// — public route (no JWT) — invite token + email; rate limited 5/IP/hour.
app.route('/api/v1/beta-signup', betaSignupRoutes);

// Admin runtime config (T-063 / M3-001 §3.5): PATCH /api/v1/admin/config
// — owner-only (JWT.email === ACMD_OWNER_EMAIL). Used to bump beta_cap_current
// (Rolling Cap D14) without redeploying.
app.route('/api/v1/admin/config', adminConfigRoutes);

// Only start server when running directly (not imported for tests)
if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] === undefined) {
  // T-101 / AC-10: surface a one-time warning at server startup when the
  // owner bypass is not configured in production. Lives here (NOT in
  // config.ts) so module-level config is side-effect-free — unit tests that
  // vi.resetModules() do not re-trigger this warning per iteration.
  // Informational only — does NOT throw because owner-bypass is optional in
  // dev (the gate still works without it; the owner just has to use a
  // regular Beta token like any other invitee).
  if (
    process.env['NODE_ENV'] === 'production'
    && (process.env['ACMD_OWNER_EMAIL'] ?? '').trim().length === 0
  ) {
    console.warn(
      '[acmd-api] ACMD_OWNER_EMAIL is empty in production — owner cannot '
      + 'bypass the Beta gate or call PATCH /api/v1/admin/config. Set this '
      + 'env var in .env.production.local before next deploy.',
    );
  }

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`ACMD API listening on http://localhost:${info.port}`);
  });
}

export default app;

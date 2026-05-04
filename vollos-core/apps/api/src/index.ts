// index.ts — VOLLOS API entry point
// Registers middleware + routes: cors, security, csrf, rate limit, leads

import 'dotenv/config';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { corsMiddleware } from './middleware/cors.js';
import { securityMiddleware } from './middleware/security.js';
import { csrfVerify, csrfGenerate } from './middleware/csrf.js';
import { leadsRouter } from './routes/leads.js';
import { unsubscribeRouter } from './routes/unsubscribe.js';
import { deletionRouter } from './routes/deletion.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('*', corsMiddleware);
app.use('*', securityMiddleware);
// I-02: Limit request body to 50KB to prevent oversized payload attacks
app.use('*', bodyLimit({ maxSize: 50 * 1024 }));
app.use('*', csrfVerify);

// ─── Health handler (shared by /health and /api/v1/health) ───────────────────
// /health is kept for Docker HEALTHCHECK + infra/monitor.sh (backwards compat).
// /api/v1/health added per CLAUDE.md K2 — all new APIs live under /api/v1/.
const healthHandler = (c: Context) =>
  c.json({ status: 'healthy', service: 'vollos-api' });

app.get('/', (c) => {
  return c.json({ status: 'ok' });
});

app.get('/health', healthHandler);

// ─── API v1 route group ───────────────────────────────────────────────────────
const v1 = new Hono();

// Health endpoint (K2 convention — mirror of root /health)
v1.get('/health', healthHandler);

// CSRF token endpoint
v1.get('/csrf', csrfGenerate, (c) => {
  const token = c.get('csrfToken' as never) as string;
  return c.json({ token });
});

// Resource routes
v1.route('/leads', leadsRouter);
v1.route('/', unsubscribeRouter);
v1.route('/', deletionRouter);

app.route('/api/v1', v1);

// ─── Start server ─────────────────────────────────────────────────────────────
// Skip serve() under vitest — tests import this module to exercise routes
// (e.g. health.test.ts) and must not open a real TCP listener.
if (!process.env['VITEST']) {
  const port = Number(process.env['PORT'] ?? 3001);
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port }, () => {
    console.log(`VOLLOS API running on http://localhost:${port}`);
  });
}

export default app;

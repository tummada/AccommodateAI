// cors.ts — CORS whitelist middleware for VOLLOS API
// Allows: https://vollos.ai, https://www.vollos.ai
// Dev: http://localhost:3000 (NODE_ENV=development only)

import { cors } from 'hono/cors';

const PROD_ORIGINS = ['https://vollos.ai', 'https://www.vollos.ai'];

const ALLOWED_ORIGINS =
  process.env['NODE_ENV'] === 'development'
    ? [...PROD_ORIGINS, 'http://localhost:3000']
    : PROD_ORIGINS;

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null;
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    return null;
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-CSRF-Token'],
  maxAge: 600,
  credentials: true,
});

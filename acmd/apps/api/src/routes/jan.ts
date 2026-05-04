/**
 * JAN (Job Accommodation Network) Search API Routes for AccommodateAI.
 *
 * Endpoints:
 *   GET /api/v1/jan/search?condition=X&job=Y&limit=20&offset=0
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - Any authenticated role can search (read-only reference data)
 *   - Input validation with Zod
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard } from '../middleware/auth.js';
import { searchJanAccommodations } from '../services/janService.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const searchQuerySchema = z.object({
  condition: z.string().min(1).max(255).optional(),
  job: z.string().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const jan = new Hono<AuthEnv>();

// All JAN routes require authentication
jan.use('*', acmdTenantGuard);

/**
 * GET /jan/search — Search JAN accommodations
 * Any authenticated role (reference data, not company-scoped)
 * Query: ?condition=mobility&job=office&limit=20&offset=0
 */
jan.get('/search', async (c) => {
  const query = c.req.query();
  const parsed = searchQuerySchema.safeParse(query);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid query parameters',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await searchJanAccommodations({
      condition: parsed.data.condition,
      job: parsed.data.job,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return c.json({
      accommodations: result.accommodations,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    }, 200);
  } catch (err) {
    console.error('[JAN] Search error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to search accommodations' }, 500);
  }
});

export { jan as janRoutes };

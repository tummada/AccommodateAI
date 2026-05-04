// @acmd/api — Admin runtime config route (T-063 / M3-001 §3.5)
//
// PATCH /api/v1/admin/config
//
// Body: { key: string, value: string }
//
// Auth: owner only — JWT claims.email === config.acmdOwnerEmail.
//   - Returns 403 'forbidden' for anyone else (including any authenticated
//     acmd user — Rolling Cap D14 is intentionally a Pon-only knob).
//   - Returns 503 if the env var is unset → fail-closed: better to refuse
//     than to silently accept an empty-string match.
//
// Behaviour:
//   - Upserts acmd.app_config (INSERT ... ON CONFLICT DO UPDATE) so the
//     endpoint also bootstraps a missing key without a separate POST.
//   - Writes the change to acmd.audit_logs with action='approval_settings_updated'
//     (closest existing enum value — runtime-config changes have the same
//     "owner-only sensitive setting" flavour as approval-settings updates).
//   - Returns 200 + { key, value, updatedAt }.
//
// NOT covered here: GET /api/v1/admin/config — Pon reads via direct SQL
// (D14 explicitly says CLI-first; UI is post-Day 16 if needed).

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { db, acmdAppConfig } from '@acmd/db';
import { acmdTenantGuard } from '../../middleware/auth.js';
import type { AcmdAuthClaims } from '../../middleware/auth.js';
import { config } from '../../config.js';
import { writeAuditLog } from '../../services/caseService.js';

const adminConfig = new Hono<AuthEnv>();

// Every admin route requires a valid JWT — the email check below is on top.
adminConfig.use('*', acmdTenantGuard);

const patchBodySchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(10_000),
});

adminConfig.patch('/', async (c) => {
  // Owner gate — fail-closed when env is missing.
  if (!config.acmdOwnerEmail) {
    console.error('[admin-config] ACMD_OWNER_EMAIL not configured — refusing PATCH');
    return c.json({ error: 'admin_disabled' }, 503);
  }

  const claims = (
    c as unknown as { get: (k: string) => AcmdAuthClaims | undefined }
  ).get('authClaims');

  // T-101 R3 (A-R2-001): trim + lowercase both sides — must match
  // betaGate.isOwnerEmail exactly so a whitespace-padded ACMD_OWNER_EMAIL
  // does not silently lock the owner out of one call site while letting
  // them through another.
  const callerEmail = claims?.email ?? '';
  if (
    callerEmail.trim().toLowerCase()
    !== config.acmdOwnerEmail.trim().toLowerCase()
  ) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = patchBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  const { key, value } = parsed.data;

  // For beta_cap_current we additionally enforce a non-negative integer.
  if (key === 'beta_cap_current') {
    const parsedInt = Number.parseInt(value, 10);
    if (!Number.isFinite(parsedInt) || parsedInt < 0 || String(parsedInt) !== value.trim()) {
      return c.json(
        { error: 'beta_cap_current must be a non-negative integer string' },
        400,
      );
    }
  }

  const now = new Date();

  // Upsert + audit inside one transaction so rollback on audit failure leaves
  // app_config untouched (matches the SEC-003 invariant from onboarding).
  let upsertedKey = key;
  let upsertedValue = value;
  let upsertedAt: Date = now;
  try {
    await db.transaction(async (tx) => {
      const upserted = await tx
        .insert(acmdAppConfig)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: acmdAppConfig.key,
          set: { value, updatedAt: now },
        })
        .returning({
          key: acmdAppConfig.key,
          value: acmdAppConfig.value,
          updatedAt: acmdAppConfig.updatedAt,
        });

      const row = upserted[0];
      if (!row) {
        throw new Error('upsert returned no row');
      }
      upsertedKey = row.key;
      upsertedValue = row.value;
      upsertedAt = row.updatedAt;

      // Audit trail. companyId for owner-level config changes is intentionally
      // empty — Rolling Cap is a global knob, not tenant-scoped — but the
      // audit_logs.company_id column is NOT NULL with a FK to acmd.companies.
      // Use the owner's own company_id (resolved from the JWT). If the owner
      // somehow has no acmd.users row yet, surface that as a 503 — we refuse
      // to mutate config without a durable audit row.
      const ownerCompanyId = claims?.company_id ?? '';
      if (!ownerCompanyId) {
        throw new OwnerNotOnboardedError();
      }
      const ownerUserId = claims?.sub ?? '';
      if (!ownerUserId) {
        throw new OwnerNotOnboardedError();
      }

      await writeAuditLog(
        {
          companyId: ownerCompanyId,
          action: 'approval_settings_updated',
          actorId: ownerUserId,
          metadata: {
            source: 'admin_config',
            key,
            // NEVER log full secrets here; we only ever store runtime knobs
            // like beta_cap_current — so logging the value is OK.
            new_value: value,
          },
        },
        tx,
      );
    });
  } catch (err) {
    if (err instanceof OwnerNotOnboardedError) {
      return c.json({ error: 'owner_not_onboarded' }, 503);
    }
    console.error('[admin-config] upsert failed', {
      key,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return c.json({ error: 'admin_config_failed' }, 500);
  }

  return c.json(
    {
      key: upsertedKey,
      value: upsertedValue,
      updatedAt: upsertedAt.toISOString(),
    },
    200,
  );
});

class OwnerNotOnboardedError extends Error {
  constructor() {
    super('Owner has no acmd.users row');
    this.name = 'OwnerNotOnboardedError';
  }
}

export { adminConfig as adminConfigRoutes };

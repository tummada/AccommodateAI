// leads.ts — Lead capture routes
// POST /api/leads  — form submission → validate → sanitize → save DB → audit log → send email (fire-and-forget) → 201
// POST /api/leads/google — Google One Tap → verify JWT → save lead → audit log → send email → 201

import { Hono } from 'hono';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { db, leads, auditLogs } from '@vollos/db';
import { eq, and, isNull } from 'drizzle-orm';
import { ipRateLimiter, emailRateLimiter, getTrustedIp } from '../middleware/rateLimit.js';
import { sendEmail } from '../email/sender.js';
import { buildAutoReply } from '../email/templates/autoReply.js';
import { verifyGoogleToken } from '../auth/googleJwt.js';
import { verifyTurnstile } from '../middleware/turnstile.js';
import { generateSignedToken } from '../config/unsubscribe.js';

const leadsRouter = new Hono();

// ─── PDPA constants ───────────────────────────────────────────────────────────
const CONSENT_VERSION = 'v1.0';
const DATA_RETENTION_YEARS = 2;

function getDataExpiresAt(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + DATA_RETENTION_YEARS);
  return d;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const LeadSchema = z.object({
  email: z.string().email().max(255).refine(e => e.split('@')[0]!.length <= 64, 'Email local-part must be 64 characters or less'),
  name: z.string().max(255).optional(),
  company: z.string().max(255).optional(),
  source: z.enum(['form', 'one_tap']).default('form'),
  productSource: z.enum(['vollos', 'acmd']).default('vollos'), // which product this lead belongs to
  productSlug: z.string().max(100).optional(),
  consentGiven: z.boolean(),
  turnstileToken: z.string().min(1),
  _hp: z.string().optional(), // honeypot field
});

const GoogleLeadSchema = z.object({
  credential: z.string().min(1),
  productSource: z.enum(['vollos', 'acmd']).default('vollos'), // which product this lead belongs to
  productSlug: z.string().max(100),
  consentGiven: z.boolean(),
  _hp: z.string().optional(), // honeypot field
});

// ─── helpers ──────────────────────────────────────────────────────────────────
// Token format: `<base36-timestamp>.<hex-hmac>` — expires 30 days after issue.
// See config/unsubscribe.ts for implementation + verification.

function stripHtml(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
}

// Mask last octet of IPv4 for PDPA-compliant storage (e.g. 1.2.3.4 → 1.2.3.0)
// IPv6 and 'unknown' are returned as-is
function anonymizeIp(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  return ip;
}

// ─── POST /api/leads ──────────────────────────────────────────────────────────
leadsRouter.post('/', ipRateLimiter, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422);
  }

  // Validate input
  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      422
    );
  }

  const data = parsed.data;
  const ip = getTrustedIp(c);
  const userAgent = c.req.header('user-agent') ?? '';

  // Honeypot check first — silently return 200 to fool bots (before any rate limit or consent check)
  if (data._hp) {
    try {
      await db.insert(auditLogs).values({ action: 'bot_honeypot', metadata: { ip, userAgent }, ipAddress: anonymizeIp(ip) });
    } catch (err) {
      console.error('[leads] honeypot audit log error:', err instanceof Error ? err.message : String(err));
    }
    return c.json({ success: true }, 200);
  }

  // Apply per-email rate limit after we have the email from parsed body
  c.set('rateLimitEmail' as never, data.email);
  const emailRateLimitResult = await emailRateLimiter(c, async () => {});
  if (emailRateLimitResult) return emailRateLimitResult;

  // Turnstile verification — before consent check so bots don't learn API behavior from consent errors
  try {
    await verifyTurnstile(data.turnstileToken, ip);
  } catch {
    return c.json({ error: 'Human verification failed' }, 422);
  }

  // PDPA: consent must be given
  if (!data.consentGiven) {
    return c.json({ error: 'Consent is required' }, 422);
  }

  // Sanitize text inputs to prevent stored XSS
  const sanitizedEmail = stripHtml(data.email)!;
  // I-01: Normalize email to lowercase — prevent case-insensitive duplicates
  const normalizedEmail = sanitizedEmail.toLowerCase();
  const sanitizedName = stripHtml(data.name);
  const sanitizedCompany = stripHtml(data.company);
  const sanitizedProductSlug = stripHtml(data.productSlug);

  try {
    // Check for duplicate email (exclude soft-deleted leads)
    const existing = await db
      .select({ id: leads.id, unsubscribedAt: leads.unsubscribedAt })
      .from(leads)
      .where(and(eq(leads.email, normalizedEmail), isNull(leads.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      const existingLead = existing[0]!;

      // Resubscribe: previously unsubscribed lead submits again with consent
      if (existingLead.unsubscribedAt !== null && data.consentGiven) {
        await db
          .update(leads)
          .set({
            unsubscribedAt: null,
            name: sanitizedName ?? undefined,
            company: sanitizedCompany ?? undefined,
            consentGiven: true,
            consentGivenAt: new Date(),
            consentVersion: CONSENT_VERSION,
            dataExpiresAt: getDataExpiresAt(),
            updatedAt: new Date(),
          })
          .where(eq(leads.id, existingLead.id));

        await db.insert(auditLogs).values({
          action: 'lead_resubscribed',
          leadId: existingLead.id,
          metadata: { ip, userAgent, source: data.source },
          ipAddress: anonymizeIp(ip),
        });

        // Send welcome email with fresh tokens
        const unsubToken = generateSignedToken(existingLead.id);
        const unsubscribeUrl = `https://vollos.ai/api/v1/unsubscribe?id=${existingLead.id}&token=${unsubToken}`;
        const deletionUrl = `https://vollos.ai/api/v1/delete?id=${existingLead.id}&token=${unsubToken}`;
        const { subject, html, text } = buildAutoReply(sanitizedName, unsubscribeUrl, deletionUrl);
        sendEmail(normalizedEmail, subject, html, text, unsubscribeUrl).catch((err: unknown) => {
          console.error('[leads] resubscribe sendEmail error:', err instanceof Error ? err.message : String(err));
        });

        return c.json({ success: true }, 200);
      }

      // Normal duplicate — audit log, do NOT reveal to user
      await db.insert(auditLogs).values({
        action: 'lead_duplicate',
        leadId: existingLead.id,
        metadata: { ip, userAgent },
        ipAddress: anonymizeIp(ip),
      });
      // Return 200 — no indication of duplicate to prevent enumeration
      return c.json({ success: true }, 200);
    }

    // NOTE: updatedAt uses defaultNow() on INSERT — any future UPDATE must explicitly set updatedAt: new Date()
    // Insert new lead
    const [newLead] = await db
      .insert(leads)
      .values({
        email: normalizedEmail,
        name: sanitizedName,
        company: sanitizedCompany,
        source: data.source,
        productSource: data.productSource,
        productSlug: sanitizedProductSlug,
        consentGiven: data.consentGiven,
        consentGivenAt: new Date(),
        consentVersion: CONSENT_VERSION,
        dataExpiresAt: getDataExpiresAt(),
        ipAddress: anonymizeIp(ip),
        userAgent,
      })
      .returning({ id: leads.id });

    // Audit log — PDPA compliant
    await db.insert(auditLogs).values({
      action: 'lead_created',
      leadId: newLead!.id,
      metadata: {
        source: data.source,
        productSource: data.productSource,
        productSlug: sanitizedProductSlug,
        userAgent,
      },
      ipAddress: anonymizeIp(ip),
    });

    // Send auto-reply email — fire and forget (do not await, do not block response)
    const unsubToken = generateSignedToken(newLead!.id);
    const unsubscribeUrl = `https://vollos.ai/api/v1/unsubscribe?id=${newLead!.id}&token=${unsubToken}`;
    const deletionUrl = `https://vollos.ai/api/v1/delete?id=${newLead!.id}&token=${unsubToken}`;
    const { subject, html, text } = buildAutoReply(sanitizedName, unsubscribeUrl, deletionUrl);
    sendEmail(normalizedEmail, subject, html, text, unsubscribeUrl).catch((err: unknown) => {
      console.error('[leads] sendEmail error:', err instanceof Error ? err.message : String(err));
    });

    return c.json({ success: true, id: newLead!.id }, 201);
  } catch (err) {
    // Log error server-side — never expose stack trace to client
    console.error('[leads] DB error:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ─── POST /api/leads/google ───────────────────────────────────────────────────
leadsRouter.post('/google', ipRateLimiter, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422);
  }

  // Validate input
  const parsed = GoogleLeadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      422
    );
  }

  const data = parsed.data;
  const ip = getTrustedIp(c);
  const userAgent = c.req.header('user-agent') ?? '';

  // NOTE: Turnstile verification is intentionally omitted for One Tap path.
  // Google JWT (verified via google-auth-library) serves as bot/human verification.

  // Honeypot check — silently return 200 to fool bots
  if (data._hp) {
    try {
      await db.insert(auditLogs).values({ action: 'bot_honeypot', metadata: { ip, userAgent, source: 'one_tap' }, ipAddress: anonymizeIp(ip) });
    } catch (err) {
      console.error('[leads/google] honeypot audit log error:', err instanceof Error ? err.message : String(err));
    }
    return c.json({ success: true }, 200);
  }

  // PDPA: consent must be given
  if (!data.consentGiven) {
    return c.json({ error: 'Consent is required' }, 422);
  }

  // Verify Google JWT
  let googlePayload: { email: string; name: string; googleId: string };
  try {
    googlePayload = await verifyGoogleToken(data.credential);
  } catch (err) {
    console.error('[leads/google] token verification failed:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Invalid Google token' }, 401);
  }

  const { email, name } = googlePayload;

  // Apply per-email rate limit after we have the email
  c.set('rateLimitEmail' as never, email);
  const emailRateLimitResultGoogle = await emailRateLimiter(c, async () => {});
  if (emailRateLimitResultGoogle) return emailRateLimitResultGoogle;

  // Sanitize email and name from Google token to prevent stored XSS (SEC-004)
  const sanitizedEmail = stripHtml(email)!;
  // I-01: Normalize email to lowercase — prevent case-insensitive duplicates
  const normalizedEmail = sanitizedEmail.toLowerCase();
  const sanitizedName = stripHtml(name);
  const sanitizedProductSlug = stripHtml(data.productSlug);

  try {
    // Check for duplicate email (exclude soft-deleted leads) — uses normalizedEmail
    const existing = await db
      .select({ id: leads.id, unsubscribedAt: leads.unsubscribedAt })
      .from(leads)
      .where(and(eq(leads.email, normalizedEmail), isNull(leads.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      const existingLead = existing[0]!;

      // Resubscribe: previously unsubscribed lead submits again with consent
      if (existingLead.unsubscribedAt !== null && data.consentGiven) {
        await db
          .update(leads)
          .set({
            unsubscribedAt: null,
            name: sanitizedName ?? undefined,
            consentGiven: true,
            consentGivenAt: new Date(),
            consentVersion: CONSENT_VERSION,
            dataExpiresAt: getDataExpiresAt(),
            updatedAt: new Date(),
          })
          .where(eq(leads.id, existingLead.id));

        await db.insert(auditLogs).values({
          action: 'lead_resubscribed',
          leadId: existingLead.id,
          metadata: { ip, userAgent, source: 'one_tap' },
          ipAddress: anonymizeIp(ip),
        });

        // Send welcome email with fresh tokens
        const unsubToken = generateSignedToken(existingLead.id);
        const unsubscribeUrl = `https://vollos.ai/api/v1/unsubscribe?id=${existingLead.id}&token=${unsubToken}`;
        const deletionUrl = `https://vollos.ai/api/v1/delete?id=${existingLead.id}&token=${unsubToken}`;
        const { subject, html, text } = buildAutoReply(sanitizedName, unsubscribeUrl, deletionUrl);
        sendEmail(normalizedEmail, subject, html, text, unsubscribeUrl).catch((err: unknown) => {
          console.error('[leads/google] resubscribe sendEmail error:', err instanceof Error ? err.message : String(err));
        });

        return c.json({ success: true }, 200);
      }

      // Normal duplicate — audit log
      await db.insert(auditLogs).values({
        action: 'lead_duplicate',
        leadId: existingLead.id,
        metadata: { ip, userAgent, source: 'one_tap' },
        ipAddress: anonymizeIp(ip),
      });
      return c.json({ success: true }, 200);
    }

    // NOTE: updatedAt uses defaultNow() on INSERT — any future UPDATE must explicitly set updatedAt: new Date()
    // Insert new lead
    const [newLead] = await db
      .insert(leads)
      .values({
        email: normalizedEmail,
        name: sanitizedName,
        source: 'one_tap',
        productSource: data.productSource,
        productSlug: sanitizedProductSlug,
        consentGiven: data.consentGiven,
        consentGivenAt: new Date(),
        consentVersion: CONSENT_VERSION,
        dataExpiresAt: getDataExpiresAt(),
        ipAddress: anonymizeIp(ip),
        userAgent,
      })
      .returning({ id: leads.id });

    // Audit log — PDPA compliant
    await db.insert(auditLogs).values({
      action: 'lead_created',
      leadId: newLead!.id,
      metadata: {
        source: 'one_tap',
        productSource: data.productSource,
        productSlug: sanitizedProductSlug,
        userAgent,
      },
      ipAddress: anonymizeIp(ip),
    });

    // Send auto-reply email — fire and forget
    const unsubToken = generateSignedToken(newLead!.id);
    const unsubscribeUrl = `https://vollos.ai/api/v1/unsubscribe?id=${newLead!.id}&token=${unsubToken}`;
    const deletionUrlGoogle = `https://vollos.ai/api/v1/delete?id=${newLead!.id}&token=${unsubToken}`;
    const { subject, html, text } = buildAutoReply(sanitizedName, unsubscribeUrl, deletionUrlGoogle);
    sendEmail(normalizedEmail, subject, html, text, unsubscribeUrl).catch((err: unknown) => {
      console.error('[leads/google] sendEmail error:', err instanceof Error ? err.message : String(err));
    });

    return c.json({ success: true, id: newLead!.id }, 201);
  } catch (err) {
    // Log error server-side — never expose stack trace to client
    console.error('[leads/google] DB error:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export { leadsRouter };

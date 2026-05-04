// unsubscribe.ts — GET /api/unsubscribe?id=<uuid>&token=<hex>
// HMAC-SHA256 token verification → mark lead as unsubscribed in DB → audit log

import { Hono } from 'hono';
import { db, leads, auditLogs } from '@vollos/db';
import { eq, and, isNull } from 'drizzle-orm';
import { verifySignedToken, SIGNED_TOKEN_RE } from '../config/unsubscribe.js';

const unsubscribeRouter = new Hono();

// ─── HTML responses ───────────────────────────────────────────────────────────
const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #0f172a; margin: 0; padding: 40px 20px; color: #e2e8f0; }
  .card { max-width: 480px; margin: 0 auto; background: #1e293b;
          border-radius: 12px; padding: 40px; text-align: center; }
  h1 { color: #ffffff; font-size: 22px; margin: 0 0 16px; }
  p { color: #94a3b8; line-height: 1.6; margin: 0 0 24px; }
  a { color: #D4AF37; text-decoration: none; }
`;

function htmlPage(title: string, heading: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — VOLLOS</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    ${body}
  </div>
</body>
</html>`;
}

const HTML_UNSUBSCRIBED = htmlPage(
  'Unsubscribed',
  'Unsubscribed',
  `<p>You've been removed from the VOLLOS mailing list.<br>
     You won't receive any further emails from us.</p>
  <p><a href="https://vollos.ai">← Return to VOLLOS</a></p>`
);

const HTML_ALREADY_UNSUBSCRIBED = htmlPage(
  'Already Unsubscribed',
  'Already Unsubscribed',
  `<p>You've already been removed from the VOLLOS mailing list.</p>
  <p><a href="https://vollos.ai">← Return to VOLLOS</a></p>`
);

const HTML_INVALID = htmlPage(
  'Invalid Link',
  'Invalid Link',
  `<p>This unsubscribe link is invalid or has expired.</p>
  <p><a href="https://vollos.ai">← Return to VOLLOS</a></p>`
);

const HTML_NOT_FOUND = htmlPage(
  'Not Found',
  'Not Found',
  `<p>We could not find your subscription record.</p>
  <p><a href="https://vollos.ai">← Return to VOLLOS</a></p>`
);

// ─── UUID + token validation ──────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Signed token format: `<base36-timestamp>.<hex-hmac>` — verified via verifySignedToken
const TOKEN_RE = SIGNED_TOKEN_RE;

// ─── Email masking for audit log ──────────────────────────────────────────────
function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  const domain = email.slice(atIdx); // includes @
  return `${email[0]}***${domain}`;
}

// ─── GET /api/unsubscribe ─────────────────────────────────────────────────────
unsubscribeRouter.get('/unsubscribe', async (c) => {
  const id = c.req.query('id') ?? '';
  const token = c.req.query('token') ?? '';

  // 1. Validate format
  if (!UUID_RE.test(id) || !TOKEN_RE.test(token)) {
    return c.html(HTML_INVALID, 400);
  }

  // 2. Query DB — exclude soft-deleted leads
  let lead: { id: string; email: string; unsubscribedAt: Date | null } | undefined;
  try {
    const rows = await db
      .select({ id: leads.id, email: leads.email, unsubscribedAt: leads.unsubscribedAt })
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    lead = rows[0];
  } catch (err) {
    console.error('[unsubscribe] DB query error:', err instanceof Error ? err.message : String(err));
    return c.html(HTML_INVALID, 500);
  }

  // 3. Not found
  if (!lead) {
    return c.html(HTML_NOT_FOUND, 404);
  }

  // 4. Verify signed token — checks format, timestamp (not future, not expired > 30d),
  //    and HMAC over "<leadId>:<timestamp>" in constant time.
  if (!verifySignedToken(id, token)) {
    return c.html(HTML_INVALID, 400);
  }

  // 5. Already unsubscribed
  if (lead.unsubscribedAt !== null) {
    return c.html(HTML_ALREADY_UNSUBSCRIBED, 200);
  }

  // 6. Update DB — set unsubscribed_at + updated_at
  // NOTE: updatedAt defaultNow() only applies on INSERT — must set explicitly on UPDATE
  try {
    await db
      .update(leads)
      .set({ unsubscribedAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, id));
  } catch (err) {
    console.error('[unsubscribe] DB update error:', err instanceof Error ? err.message : String(err));
    return c.html(HTML_INVALID, 500);
  }

  // 7. Audit log with masked email
  const maskedEmail = maskEmail(lead.email);
  try {
    await db.insert(auditLogs).values({
      action: 'lead_unsubscribed',
      leadId: lead.id,
      metadata: { email_masked: maskedEmail },
    });
  } catch (err) {
    // Audit log failure is non-fatal — log and continue
    console.error('[unsubscribe] audit log error:', err instanceof Error ? err.message : String(err));
  }

  // 8. Return confirmation page
  return c.html(HTML_UNSUBSCRIBED, 200);
});

export { unsubscribeRouter };

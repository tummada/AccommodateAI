// deletion.ts — GET /api/delete?id=<uuid>&token=<hex>
// CCPA data deletion: HMAC-SHA256 token verification → anonymize PII → audit log
// Follows same pattern as unsubscribe.ts

import { Hono } from 'hono';
import { db, leads, auditLogs } from '@vollos/db';
import { eq } from 'drizzle-orm';
import { verifySignedToken, SIGNED_TOKEN_RE } from '../config/unsubscribe.js';
import { ipRateLimiter } from '../middleware/rateLimit.js';

const deletionRouter = new Hono();

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

const HTML_DELETED = htmlPage(
  'Data Deleted',
  'Your Data Has Been Deleted',
  `<p>Your personal data has been removed from our systems.<br>
     This action is permanent and cannot be undone.</p>
  <p><a href="https://vollos.ai">&larr; Return to VOLLOS</a></p>`
);

const HTML_ALREADY_DELETED = htmlPage(
  'Already Deleted',
  'Already Deleted',
  `<p>Your data has already been removed from our systems.</p>
  <p><a href="https://vollos.ai">&larr; Return to VOLLOS</a></p>`
);

const HTML_INVALID = htmlPage(
  'Invalid Link',
  'Invalid Link',
  `<p>This deletion link is invalid or has expired.</p>
  <p><a href="https://vollos.ai">&larr; Return to VOLLOS</a></p>`
);

const HTML_NOT_FOUND = htmlPage(
  'Not Found',
  'Not Found',
  `<p>We could not find your record.</p>
  <p><a href="https://vollos.ai">&larr; Return to VOLLOS</a></p>`
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

// ─── GET /api/delete ──────────────────────────────────────────────────────────
deletionRouter.get('/delete', ipRateLimiter, async (c) => {
  const id = c.req.query('id') ?? '';
  const token = c.req.query('token') ?? '';

  // 1. Validate format
  if (!UUID_RE.test(id) || !TOKEN_RE.test(token)) {
    return c.html(HTML_INVALID, 400);
  }

  // 2. Query DB
  let lead: { id: string; email: string; deletedAt: Date | null } | undefined;
  try {
    const rows = await db
      .select({ id: leads.id, email: leads.email, deletedAt: leads.deletedAt })
      .from(leads)
      .where(eq(leads.id, id))
      .limit(1);
    lead = rows[0];
  } catch (err) {
    console.error('[deletion] DB query error:', err instanceof Error ? err.message : String(err));
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

  // 5. Already deleted
  if (lead.deletedAt !== null) {
    return c.html(HTML_ALREADY_DELETED, 200);
  }

  // 6. Anonymize PII + set deletedAt
  // CCPA §1798.105 "Right to Delete" — clear all identifiers including
  // IP address and user-agent (both qualify as personal information under CCPA).
  const maskedEmail = maskEmail(lead.email);
  try {
    await db
      .update(leads)
      .set({
        email: `deleted_${id}@anonymous`,
        name: 'Deleted',
        company: null,
        ipAddress: null,
        userAgent: null,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
  } catch (err) {
    console.error('[deletion] DB update error:', err instanceof Error ? err.message : String(err));
    return c.html(HTML_INVALID, 500);
  }

  // 7. Audit log with masked email (original email before anonymization)
  try {
    await db.insert(auditLogs).values({
      action: 'lead_deleted_ccpa',
      leadId: lead.id,
      metadata: { email_masked: maskedEmail },
    });
  } catch (err) {
    // Audit log failure is non-fatal — log and continue
    console.error('[deletion] audit log error:', err instanceof Error ? err.message : String(err));
  }

  // 8. Return confirmation page
  return c.html(HTML_DELETED, 200);
});

export { deletionRouter };

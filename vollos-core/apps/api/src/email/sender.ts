// sender.ts — Nodemailer OAuth2 email sender with exponential backoff retry
// sendEmail(to, subject, html, text) — fire-and-forget safe (never throws)

import nodemailer from 'nodemailer';

// ─── Retry delays (ms) ────────────────────────────────────────────────────────
const RETRY_DELAYS = [1000, 5000, 30000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── maskEmail ─────────────────────────────────────────────────────────────────
// Masks email address for safe logging (PDPA compliance)
// Examples: 'johndoe@example.com' → 'jo***@example.com'
//           'jo@x.com'           → 'j***@x.com'
//           'not-an-email'       → '***'
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex); // includes '@'
  const prefix = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${prefix}***${domain}`;
}

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env['GMAIL_USER'],
      clientId: process.env['GOOGLE_CLIENT_ID'],
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
      refreshToken: process.env['GOOGLE_REFRESH_TOKEN'],
    },
  });
}

// ─── sendEmail ─────────────────────────────────────────────────────────────────
// Never throws — logs error after all retries exhausted
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  unsubscribeUrl?: string
): Promise<void> {
  // SEC-005: CRLF injection guard — reject if to or subject contains \r or \n
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    console.error(`[email] CRLF injection attempt blocked — to: ${maskEmail(to)}`);
    return;
  }

  const transport = createTransport();

  // SEC-002: List-Unsubscribe headers for one-click unsubscribe (RFC 8058)
  const headers: Record<string, string> = {};
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      await transport.sendMail({
        from: `Pon from VOLLOS <${process.env['GMAIL_USER']}>`,
        to,
        subject,
        html,
        text,
        headers,
      });
      return; // success
    } catch (err) {
      const delay = RETRY_DELAYS[attempt]!;
      console.error(
        `[email] sendEmail attempt ${attempt + 1} failed (retry in ${delay}ms):`,
        err instanceof Error ? err.message : String(err)
      );
      if (attempt < RETRY_DELAYS.length - 1) {
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — log final error, do NOT throw
  console.error(`[email] sendEmail failed after ${RETRY_DELAYS.length} attempts to: ${maskEmail(to)}`);
  console.error('[email] FINAL FAILURE - manual intervention required for:', maskEmail(to));
}

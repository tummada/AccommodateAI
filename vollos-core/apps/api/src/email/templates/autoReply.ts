// autoReply.ts — Email auto-reply template for VOLLOS lead capture
// buildAutoReply(name) → { subject, html, text }

export interface AutoReplyContent {
  subject: string;
  html: string;
  text: string;
}

// ─── escapeHtml ───────────────────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── buildAutoReply ───────────────────────────────────────────────────────────
export function buildAutoReply(name?: string, unsubscribeUrl?: string, deletionUrl?: string): AutoReplyContent {
  const displayName = name ? name : 'there';

  const subject = `You're on the VOLLOS early access list`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #0f172a; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; margin: 0; letter-spacing: -0.5px; }
    .body { padding: 40px; color: #374151; line-height: 1.7; }
    .body h2 { color: #0f172a; font-size: 20px; margin-top: 0; }
    .next-steps { background: #f8fafc; border-left: 4px solid #D4AF37; padding: 16px 20px; border-radius: 0 6px 6px 0; margin: 24px 0; }
    .next-steps p { margin: 0 0 8px; font-weight: 600; color: #0f172a; }
    .next-steps ol { margin: 0; padding-left: 20px; color: #374151; }
    .next-steps li { margin-bottom: 8px; }
    .reply-cta { background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px 20px; margin: 24px 0; font-size: 14px; color: #6b7280; }
    .reply-cta strong { color: #0f172a; }
    .footer { background: #f8fafc; padding: 24px 40px; text-align: center; color: #9ca3af; font-size: 13px; border-top: 1px solid #e5e7eb; }
    .footer a { color: #6b7280; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://vollos.ai/logo-white.png" alt="VOLLOS" width="68" height="64" style="display:block;margin:0 auto 12px;">
    </div>
    <div class="body">
      <h2>Hi ${escapeHtml(displayName)},</h2>
      <p>You're in. I've added you to the VOLLOS early access list.</p>
      <p>VOLLOS automates the compliance work your HR team dreads — accommodation requests, filing deadlines, policy tracking — so your people can focus on work that actually matters.</p>
      <div class="next-steps">
        <p>What happens next:</p>
        <ol>
          <li>I'll personally review your submission and reach out within 2 business days</li>
          <li>I'll follow up by email with a few questions about your team's current workflow</li>
          <li>If it's a good fit, you'll get access before our public launch</li>
        </ol>
      </div>
      <div class="reply-cta">
        <strong>Questions?</strong> Reply to this email — it goes straight to me.
      </div>
      <p>
        Chalermpon (Pon)<br>
        <strong>Founder, VOLLOS</strong><br>
        <a href="mailto:pon@vollos.ai" style="color: #6b7280;">pon@vollos.ai</a>
      </p>
    </div>
    <div class="footer">
      <p>VOLLOS · 295 Moo 3 · Mueang Si Khai, Warin Chamrap, Ubon Ratchathani 34190 · Thailand · <a href="mailto:pon@vollos.ai" style="color:#9ca3af;">pon@vollos.ai</a></p>
      ${unsubscribeUrl ? `<p style="margin-top:8px;"><a href="${unsubscribeUrl}" style="color:#9ca3af;font-size:12px;">Unsubscribe</a>${deletionUrl ? ` · <a href="${deletionUrl}" style="color:#9ca3af;font-size:12px;">Delete my data</a>` : ''}</p>` : ''}
      <p>&copy; 2026 VOLLOS. All rights reserved.</p>
      <p><a href="https://vollos.ai">vollos.ai</a></p>
      <p style="margin-top: 12px; font-size: 11px; color: #d1d5db;">
        You received this email because you signed up at vollos.ai.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hi ${displayName},

You're in. I've added you to the VOLLOS early access list.

VOLLOS automates the compliance work your HR team dreads — accommodation requests, filing deadlines, policy tracking — so your people can focus on work that actually matters.

WHAT HAPPENS NEXT:
1. I'll personally review your submission and reach out within 2 business days
2. I'll follow up by email with a few questions about your team's current workflow
3. If it's a good fit, you'll get access before our public launch

Questions? Reply to this email — it goes straight to me.

Chalermpon (Pon)
Founder, VOLLOS
pon@vollos.ai

---
VOLLOS · 295 Moo 3 · Mueang Si Khai, Warin Chamrap, Ubon Ratchathani 34190 · Thailand · pon@vollos.ai
© 2026 VOLLOS. All rights reserved.
https://vollos.ai

You received this email because you signed up at vollos.ai.${unsubscribeUrl ? `\n\nTo unsubscribe: ${unsubscribeUrl}` : ''}${deletionUrl ? `\nDelete my data: ${deletionUrl}` : ''}`;

  return { subject, html, text };
}

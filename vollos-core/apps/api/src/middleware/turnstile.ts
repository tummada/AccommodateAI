// turnstile.ts — Cloudflare Turnstile verification helper
// verifyTurnstile(token, ip): Promise<void>
// throws if verification fails, service unavailable, or token already consumed
//
// Replay prevention (audit MEDIUM-6):
//   We call isUsed(token) BEFORE siteverify to reject replayed tokens without
//   burning a network round-trip. On successful verify we call markUsed(token)
//   so the same token cannot be reused within its 5-minute validity window.
//   If siteverify itself fails we DO NOT mark the token — an attacker could
//   otherwise spoof arbitrary strings to pre-lock future legitimate tokens.
//   See turnstileReplayCache.ts for cache design + residual-risk notes.

import { isUsed, markUsed } from './turnstileReplayCache.js';

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Fail fast at startup if secret is missing — prevents silent empty-string auth bypass
const _secret = process.env.TURNSTILE_SECRET_KEY;
if (!_secret) throw new Error('[turnstile] TURNSTILE_SECRET_KEY is not set');
const secret: string = _secret;

export async function verifyTurnstile(token: string, ip: string): Promise<void> {
  // Replay prevention — reject consumed tokens before hitting Cloudflare
  if (isUsed(token)) {
    throw new Error('Turnstile token already consumed');
  }

  let res: Response;
  try {
    res = await fetch(TURNSTILE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
    });
  } catch {
    throw new Error('Turnstile service unavailable');
  }

  if (!res.ok) {
    throw new Error('Turnstile service unavailable');
  }

  let json: { success: boolean };
  try {
    json = (await res.json()) as { success: boolean };
  } catch {
    throw new Error('Turnstile service unavailable');
  }

  if (!json.success) {
    throw new Error('Turnstile verification failed');
  }

  // Mark token as consumed only AFTER a successful verification.
  // Marking on failure would let attackers preemptively invalidate other users' tokens.
  markUsed(token);
}

// googleJwt.ts — Google One Tap JWT verification
// verifyGoogleToken(credential) → { email, name, googleId }
// throws Error if token is invalid

import { OAuth2Client } from 'google-auth-library';

export interface GoogleTokenPayload {
  email: string;
  name: string;
  googleId: string;
}

const client = new OAuth2Client(process.env['GOOGLE_CLIENT_ID']);

// ─── verifyGoogleToken ────────────────────────────────────────────────────────
export async function verifyGoogleToken(credential: string): Promise<GoogleTokenPayload> {
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env['GOOGLE_CLIENT_ID'],
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Invalid Google token: empty payload');
  }

  const email = payload['email'];
  const name = payload['name'];
  const googleId = payload['sub'];

  if (!email) {
    throw new Error('Invalid Google token: missing email claim');
  }

  // SEC-006: Reject tokens where email is not verified by Google
  if (!payload['email_verified']) {
    throw new Error('Invalid Google token: email not verified');
  }
  if (!googleId) {
    throw new Error('Invalid Google token: missing sub claim');
  }

  return {
    email,
    name: name ?? email.split('@')[0] ?? 'User',
    googleId,
  };
}

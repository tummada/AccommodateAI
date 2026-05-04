// @acmd/auth — Google Token Verification
// Uses google-auth-library (validates signature + issuer + audience)
// SKILL.md L88: "MUST use google-auth-library OAuth2Client.verifyIdToken"
// SKILL.md L88: "library validates aud + iss automatically"
// SKILL.md L89: "hd claim must be verified manually after verifyIdToken()"

import { OAuth2Client } from 'google-auth-library';
import type { GoogleVerifiedPayload } from './types.js';

export interface VerifyGoogleTokenOptions {
  clientId: string;
  /** Optional: restrict to a specific hosted domain (e.g. 'company.com') */
  hostedDomain?: string;
}

/**
 * Verify a Google id_token (from Google One Tap / Sign In With Google).
 *
 * - Uses google-auth-library which handles JWKS caching + auto-refresh automatically.
 * - Verifies: signature, issuer (accounts.google.com), audience (clientId), expiry.
 * - On failure throws an error — caller must catch and return 401.
 *
 * @throws {Error} if token is invalid, expired, or audience mismatch
 */
export async function verifyGoogleToken(
  idToken: string,
  options: VerifyGoogleTokenOptions,
): Promise<GoogleVerifiedPayload> {
  const client = new OAuth2Client(options.clientId);

  // google-auth-library throws on invalid/expired/wrong-audience token
  const ticket = await client.verifyIdToken({
    idToken,
    audience: options.clientId,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Empty token payload');
  }

  // Validate required claims
  if (!payload.email) {
    throw new Error('Missing email claim in Google token');
  }
  if (!payload.sub) {
    throw new Error('Missing sub claim in Google token');
  }
  if (!payload.name) {
    throw new Error('Missing name claim in Google token');
  }

  // Verify hosted domain claim if required
  // SKILL.md L89: "hd claim must be verified manually — verifyIdToken() does not validate hd"
  if (options.hostedDomain !== undefined) {
    if (payload.hd !== options.hostedDomain) {
      throw new Error(
        `Token hd claim '${payload.hd}' does not match expected domain '${options.hostedDomain}'`,
      );
    }
  }

  return {
    email: payload.email,
    name: payload.name,
    google_id: payload.sub,
    email_verified: payload.email_verified ?? false,
  };
}

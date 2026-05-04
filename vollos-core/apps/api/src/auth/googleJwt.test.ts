// googleJwt.test.ts — Unit tests for verifyGoogleToken
// Mocks google-auth-library — never calls real Google API

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock google-auth-library ─────────────────────────────────────────────────
const mockGetPayload = vi.fn();
const mockVerifyIdToken = vi.fn();

vi.mock('google-auth-library', () => {
  class OAuth2Client {
    verifyIdToken = mockVerifyIdToken;
    constructor(_clientId?: string) {}
  }
  return { OAuth2Client };
});

// Import after mocks
const { verifyGoogleToken } = await import('./googleJwt.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyGoogleToken', () => {
  it('returns email, name, and googleId from valid token', async () => {
    mockGetPayload.mockReturnValue({
      email: 'user@example.com',
      email_verified: true,
      name: 'Test User',
      sub: 'google-id-12345',
    });
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    const result = await verifyGoogleToken('valid.jwt.token');

    expect(result).toEqual({
      email: 'user@example.com',
      name: 'Test User',
      googleId: 'google-id-12345',
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid.jwt.token',
      audience: process.env['GOOGLE_CLIENT_ID'],
    });
  });

  it('throws when verifyIdToken rejects (invalid token)', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Token used too late'));

    await expect(verifyGoogleToken('expired.jwt.token')).rejects.toThrow('Token used too late');
  });

  it('throws when payload is null', async () => {
    mockGetPayload.mockReturnValue(null);
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    await expect(verifyGoogleToken('token-with-null-payload')).rejects.toThrow(
      'Invalid Google token: empty payload'
    );
  });

  it('throws when email claim is missing', async () => {
    mockGetPayload.mockReturnValue({
      name: 'Test User',
      sub: 'google-id-12345',
      // email missing
    });
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    await expect(verifyGoogleToken('token-no-email')).rejects.toThrow(
      'Invalid Google token: missing email claim'
    );
  });

  it('throws when email is not verified', async () => {
    mockGetPayload.mockReturnValue({
      email: 'user@example.com',
      email_verified: false,
      name: 'Test User',
      sub: 'google-id-12345',
    });
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    await expect(verifyGoogleToken('token-unverified-email')).rejects.toThrow(
      'Invalid Google token: email not verified'
    );
  });

  it('throws when sub (googleId) claim is missing', async () => {
    mockGetPayload.mockReturnValue({
      email: 'user@example.com',
      email_verified: true,
      name: 'Test User',
      // sub missing
    });
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    await expect(verifyGoogleToken('token-no-sub')).rejects.toThrow(
      'Invalid Google token: missing sub claim'
    );
  });

  it('uses email prefix as name fallback when name claim is missing', async () => {
    mockGetPayload.mockReturnValue({
      email: 'john@example.com',
      email_verified: true,
      sub: 'google-id-99',
      // name missing
    });
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    const result = await verifyGoogleToken('token-no-name');

    expect(result.name).toBe('john');
    expect(result.email).toBe('john@example.com');
  });

  it('uses GOOGLE_CLIENT_ID env var as audience', async () => {
    mockGetPayload.mockReturnValue({
      email: 'user@example.com',
      email_verified: true,
      name: 'User',
      sub: 'gid-123',
    });
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: mockGetPayload });

    await verifyGoogleToken('some.token');

    expect(mockVerifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: process.env['GOOGLE_CLIENT_ID'],
      })
    );
  });
});

// Unit tests for verifyGoogleToken()
// Uses vitest — mocks google-auth-library (no real Google calls)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyGoogleToken } from '../src/googleAuth.js';

// Shared mutable mock for verifyIdToken — updated per test
let mockVerifyIdTokenImpl: (() => Promise<unknown>) | null = null;

// Mock the entire google-auth-library module
vi.mock('google-auth-library', () => {
  return {
    OAuth2Client: function MockOAuth2Client(_clientId: string) {
      return {
        verifyIdToken: function (_opts: unknown) {
          if (!mockVerifyIdTokenImpl) throw new Error('mockVerifyIdTokenImpl not set');
          return mockVerifyIdTokenImpl();
        },
      };
    },
  };
});

describe('verifyGoogleToken()', () => {
  beforeEach(() => {
    mockVerifyIdTokenImpl = null;
  });

  it('returns verified payload for a valid token', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-123',
        email: 'alice@example.com',
        name: 'Alice Smith',
        email_verified: true,
      }),
    });

    const result = await verifyGoogleToken('valid.id.token', {
      clientId: 'my-client-id',
    });

    expect(result).toEqual({
      google_id: 'google-uid-123',
      email: 'alice@example.com',
      name: 'Alice Smith',
      email_verified: true,
    });
  });

  it('throws when google-auth-library throws (invalid/expired token)', async () => {
    mockVerifyIdTokenImpl = async () => {
      throw new Error('Token used too late');
    };

    await expect(
      verifyGoogleToken('expired.token', { clientId: 'my-client-id' }),
    ).rejects.toThrow();
  });

  it('throws when payload is null', async () => {
    mockVerifyIdTokenImpl = async () => ({ getPayload: () => null });

    await expect(
      verifyGoogleToken('valid.token', { clientId: 'my-client-id' }),
    ).rejects.toThrow('Empty token payload');
  });

  it('throws when email claim is missing', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'uid-123',
        // no email
        name: 'Alice',
        email_verified: true,
      }),
    });

    await expect(
      verifyGoogleToken('token', { clientId: 'cid' }),
    ).rejects.toThrow('Missing email claim');
  });

  it('throws when sub claim is missing', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        // no sub
        email: 'alice@example.com',
        name: 'Alice',
        email_verified: true,
      }),
    });

    await expect(
      verifyGoogleToken('token', { clientId: 'cid' }),
    ).rejects.toThrow('Missing sub claim');
  });

  it('throws when hosted domain does not match', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'uid-123',
        email: 'alice@other.com',
        name: 'Alice',
        email_verified: true,
        hd: 'other.com', // wrong domain
      }),
    });

    await expect(
      verifyGoogleToken('token', {
        clientId: 'cid',
        hostedDomain: 'expected.com',
      }),
    ).rejects.toThrow("does not match expected domain 'expected.com'");
  });

  it('accepts token when hosted domain matches', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'uid-123',
        email: 'alice@company.com',
        name: 'Alice',
        email_verified: true,
        hd: 'company.com',
      }),
    });

    const result = await verifyGoogleToken('token', {
      clientId: 'cid',
      hostedDomain: 'company.com',
    });

    expect(result.email).toBe('alice@company.com');
  });
});

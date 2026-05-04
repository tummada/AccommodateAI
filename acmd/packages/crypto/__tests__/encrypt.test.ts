import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, validateKey } from '../src/encrypt.js';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyHex(): string {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// validateKey
// ---------------------------------------------------------------------------

describe('validateKey()', () => {
  it('returns a Buffer for a valid 64-char hex key', () => {
    const key = makeKeyHex();
    const buf = validateKey(key);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('throws for a key that is too short', () => {
    expect(() => validateKey('abc123')).toThrow(/64/);
  });

  it('throws for a key that is too long', () => {
    expect(() => validateKey(makeKeyHex() + 'aa')).toThrow(/64/);
  });

  it('throws for a key with non-hex characters', () => {
    const badKey = 'z'.repeat(64);
    expect(() => validateKey(badKey)).toThrow(/non-hex/);
  });

  it('throws for an empty string', () => {
    expect(() => validateKey('')).toThrow();
  });

  it('throws for a non-string value', () => {
    // @ts-expect-error testing runtime type check
    expect(() => validateKey(12345)).toThrow(/string/);
  });
});

// ---------------------------------------------------------------------------
// encrypt
// ---------------------------------------------------------------------------

describe('encrypt()', () => {
  it('returns a string in iv:authTag:ciphertext format', () => {
    const key = makeKeyHex();
    const ct = encrypt('hello world', key);
    const parts = ct.split(':');
    expect(parts.length).toBe(3);
    // Each part must be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const key = makeKeyHex();
    const ct1 = encrypt('same plaintext', key);
    const ct2 = encrypt('same plaintext', key);
    expect(ct1).not.toBe(ct2);
  });

  it('output is not equal to plaintext (actually encrypted)', () => {
    const key = makeKeyHex();
    const plaintext = 'sensitive medical info';
    const ct = encrypt(plaintext, key);
    expect(ct).not.toContain(plaintext);
  });

  it('throws on invalid key', () => {
    expect(() => encrypt('text', 'tooshort')).toThrow();
  });

  it('encrypts empty string without error', () => {
    const key = makeKeyHex();
    expect(() => encrypt('', key)).not.toThrow();
  });

  it('encrypts unicode / special characters', () => {
    const key = makeKeyHex();
    const plaintext = '日本語テスト 🔒 <script>alert(1)</script>';
    const ct = encrypt(plaintext, key);
    const decrypted = decrypt(ct, key);
    expect(decrypted).toBe(plaintext);
  });
});

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------

describe('decrypt()', () => {
  it('round-trips plaintext correctly', () => {
    const key = makeKeyHex();
    const plaintext = 'patient data — HIPAA adjacent';
    const ct = encrypt(plaintext, key);
    expect(decrypt(ct, key)).toBe(plaintext);
  });

  it('throws a generic error on wrong key (no plaintext in message)', () => {
    const key1 = makeKeyHex();
    const key2 = makeKeyHex();
    const ct = encrypt('secret', key1);

    let thrownError: Error | undefined;
    try {
      decrypt(ct, key2);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toBe('encryption/decryption error');
    // Must NOT leak plaintext
    expect(thrownError!.message).not.toContain('secret');
  });

  it('throws a generic error on malformed ciphertext (no colon)', () => {
    const key = makeKeyHex();
    expect(() => decrypt('notvalidciphertext', key)).toThrow(
      'encryption/decryption error',
    );
  });

  it('throws on tampered auth tag (GCM integrity check)', () => {
    const key = makeKeyHex();
    const ct = encrypt('integrity check', key);
    // Tamper with the auth tag (second segment)
    const parts = ct.split(':');
    parts[1] = Buffer.alloc(16, 0xff).toString('base64');
    const tampered = parts.join(':');
    expect(() => decrypt(tampered, key)).toThrow('encryption/decryption error');
  });

  it('decrypts empty-string plaintext', () => {
    const key = makeKeyHex();
    const ct = encrypt('', key);
    expect(decrypt(ct, key)).toBe('');
  });

  it('throws on invalid key', () => {
    expect(() => decrypt('a:b:c', 'badkey')).toThrow();
  });
});

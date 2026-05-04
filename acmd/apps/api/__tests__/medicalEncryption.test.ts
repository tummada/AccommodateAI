/**
 * Unit tests for medicalEncryption service.
 *
 * Covers:
 *   - encrypt/decrypt round-trip
 *   - missing ACMD_ENCRYPTION_KEY → throw
 *   - wrong key → decrypt fails gracefully (no crash, no plaintext leak)
 *   - error messages do NOT contain medical data
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

// Generate valid test keys (64 hex chars = 32 bytes)
const TEST_KEY = randomBytes(32).toString('hex');
const WRONG_KEY = randomBytes(32).toString('hex');

describe('medicalEncryption', () => {
  let encryptMedical: typeof import('../src/services/medicalEncryption.js').encryptMedical;
  let decryptMedical: typeof import('../src/services/medicalEncryption.js').decryptMedical;

  const ORIGINAL_ENV = process.env['ACMD_ENCRYPTION_KEY'];

  beforeEach(async () => {
    // Set valid key for tests that need it
    process.env['ACMD_ENCRYPTION_KEY'] = TEST_KEY;
    // Re-import to pick up fresh env
    const mod = await import('../src/services/medicalEncryption.js');
    encryptMedical = mod.encryptMedical;
    decryptMedical = mod.decryptMedical;
  });

  afterEach(() => {
    // Restore original env
    if (ORIGINAL_ENV !== undefined) {
      process.env['ACMD_ENCRYPTION_KEY'] = ORIGINAL_ENV;
    } else {
      delete process.env['ACMD_ENCRYPTION_KEY'];
    }
  });

  // ---------------------------------------------------------------------------
  // Round-trip
  // ---------------------------------------------------------------------------

  it('encrypts and decrypts medical data correctly (round-trip)', () => {
    const plaintext = 'Patient has chronic back pain. Needs standing desk.';
    const ciphertext = encryptMedical(plaintext);

    // Ciphertext should not contain plaintext
    expect(ciphertext).not.toContain(plaintext);
    // Ciphertext format: iv:authTag:data (3 base64 parts separated by ":")
    expect(ciphertext.split(':')).toHaveLength(3);

    const decrypted = decryptMedical(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'Needs wheelchair ramp access';
    const ct1 = encryptMedical(plaintext);
    const ct2 = encryptMedical(plaintext);
    expect(ct1).not.toBe(ct2);

    // Both decrypt to same value
    expect(decryptMedical(ct1)).toBe(plaintext);
    expect(decryptMedical(ct2)).toBe(plaintext);
  });

  it('handles empty string', () => {
    const ciphertext = encryptMedical('');
    const decrypted = decryptMedical(ciphertext);
    expect(decrypted).toBe('');
  });

  it('handles unicode / multilingual text', () => {
    const plaintext = 'ผู้ป่วยมีอาการปวดหลังเรื้อรัง 🏥';
    const ciphertext = encryptMedical(plaintext);
    expect(decryptMedical(ciphertext)).toBe(plaintext);
  });

  // ---------------------------------------------------------------------------
  // Missing key
  // ---------------------------------------------------------------------------

  it('throws when ACMD_ENCRYPTION_KEY is not set (encrypt)', () => {
    delete process.env['ACMD_ENCRYPTION_KEY'];
    expect(() => encryptMedical('secret medical data')).toThrow(
      'ACMD_ENCRYPTION_KEY is not set',
    );
  });

  it('throws when ACMD_ENCRYPTION_KEY is not set (decrypt)', () => {
    // Encrypt with valid key first
    const ciphertext = encryptMedical('test data');
    delete process.env['ACMD_ENCRYPTION_KEY'];
    expect(() => decryptMedical(ciphertext)).toThrow(
      'ACMD_ENCRYPTION_KEY is not set',
    );
  });

  // ---------------------------------------------------------------------------
  // Wrong key
  // ---------------------------------------------------------------------------

  it('fails gracefully with wrong key — does not crash', () => {
    const ciphertext = encryptMedical('Top secret diagnosis');

    // Switch to wrong key
    process.env['ACMD_ENCRYPTION_KEY'] = WRONG_KEY;

    expect(() => decryptMedical(ciphertext)).toThrow(
      'medical data processing error',
    );
  });

  it('wrong key error does NOT contain plaintext or ciphertext', () => {
    const plaintext = 'Highly sensitive medical information XYZ123';
    const ciphertext = encryptMedical(plaintext);

    process.env['ACMD_ENCRYPTION_KEY'] = WRONG_KEY;

    try {
      decryptMedical(ciphertext);
      expect.fail('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(plaintext);
      expect(message).not.toContain('XYZ123');
      expect(message).toBe('medical data processing error');
    }
  });

  // ---------------------------------------------------------------------------
  // No medical data logging
  // ---------------------------------------------------------------------------

  it('error messages never contain medical content', () => {
    const sensitiveData = 'HIPAA-PROTECTED-DIAGNOSIS-ABC789';

    // Test encrypt error path (invalid key format)
    process.env['ACMD_ENCRYPTION_KEY'] = 'invalid-key';
    try {
      encryptMedical(sensitiveData);
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).not.toContain(sensitiveData);
      expect(msg).not.toContain('ABC789');
    }

    // Test decrypt error path
    process.env['ACMD_ENCRYPTION_KEY'] = TEST_KEY;
    try {
      decryptMedical('not:valid:ciphertext');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toBe('medical data processing error');
    }
  });
});

/**
 * Medical data encryption service for AccommodateAI.
 *
 * Wraps @acmd/crypto to encrypt/decrypt medical_info (PHI).
 * Key: env var ACMD_ENCRYPTION_KEY (hex 64 chars = 32 bytes).
 *
 * SECURITY:
 *   - Never log medical data content
 *   - Error messages must be generic: "medical data processing error"
 *   - If key is missing, throw immediately (fail-fast, never write plaintext)
 */

import { encrypt, decrypt, validateKey } from '@acmd/crypto';

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Reads and validates ACMD_ENCRYPTION_KEY from env.
 * Throws a generic error if the key is missing or malformed.
 */
function getEncryptionKey(): string {
  const key = process.env['ACMD_ENCRYPTION_KEY'];
  if (!key) {
    throw new Error(
      'ACMD_ENCRYPTION_KEY is not set — refusing to process medical data',
    );
  }
  // validateKey throws if format is wrong (not 64 hex chars)
  validateKey(key);
  return key;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt medical plaintext before writing to the database.
 *
 * @param plaintext - Raw medical info (PHI)
 * @returns Ciphertext string safe to store in DB
 * @throws Error with generic message if key missing/invalid
 */
export function encryptMedical(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    return encrypt(plaintext, key);
  } catch (error) {
    // Re-throw key-missing errors as-is (they don't contain PHI)
    if (
      error instanceof Error &&
      error.message.startsWith('ACMD_ENCRYPTION_KEY')
    ) {
      throw error;
    }
    // For all other errors, use generic message — never leak PHI
    throw new Error('medical data processing error');
  }
}

/**
 * Decrypt medical ciphertext after reading from the database.
 *
 * @param ciphertext - Encrypted medical info from DB
 * @returns Decrypted plaintext
 * @throws Error with generic message on failure (wrong key, corrupt data)
 */
export function decryptMedical(ciphertext: string): string {
  try {
    const key = getEncryptionKey();
    return decrypt(ciphertext, key);
  } catch (error) {
    // Re-throw key-missing errors as-is
    if (
      error instanceof Error &&
      error.message.startsWith('ACMD_ENCRYPTION_KEY')
    ) {
      throw error;
    }
    // Generic error — never leak plaintext or key material
    throw new Error('medical data processing error');
  }
}

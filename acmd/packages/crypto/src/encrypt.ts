/**
 * AES-256-GCM encrypt/decrypt utilities.
 *
 * Key format: hex string 64 characters = 32 bytes.
 * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Output format: ${iv}:${authTag}:${ciphertext}  (each part base64-encoded)
 * ":" is safe as delimiter because base64 does not contain ":".
 *
 * SECURITY: Never log decrypted content. On error, log only "encryption/decryption error".
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // bytes — recommended for GCM
const AUTH_TAG_LENGTH = 16; // bytes
const KEY_BYTES = 32;

// ---------------------------------------------------------------------------
// validateKey
// ---------------------------------------------------------------------------

/**
 * Validate and parse a hex-encoded 32-byte key.
 * Throws immediately if the key is malformed — fail fast on startup.
 *
 * @param keyHex - 64-character hex string representing 32 bytes
 * @returns Buffer of the key bytes
 */
export function validateKey(keyHex: string): Buffer {
  if (typeof keyHex !== 'string') {
    throw new Error(`validateKey: key must be a string, got ${typeof keyHex}`);
  }
  if (keyHex.length !== KEY_BYTES * 2) {
    throw new Error(
      `validateKey: key must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes), got ${keyHex.length} characters`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('validateKey: key contains non-hex characters');
  }
  return Buffer.from(keyHex, 'hex');
}

// ---------------------------------------------------------------------------
// encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext with AES-256-GCM using a random IV.
 * Each call produces a different ciphertext even for identical plaintext.
 *
 * @param plaintext - UTF-8 string to encrypt
 * @param keyHex   - 64-char hex key
 * @returns `${iv}:${authTag}:${ciphertext}` (base64 parts)
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const keyBuf = validateKey(keyHex);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, keyBuf, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt a ciphertext produced by `encrypt()`.
 *
 * @param ciphertext - `${iv}:${authTag}:${ciphertext}` (base64 parts)
 * @param keyHex     - 64-char hex key
 * @returns Decrypted UTF-8 string
 * @throws Error with generic message on any failure (no plaintext in message)
 */
export function decrypt(ciphertext: string, keyHex: string): string {
  const keyBuf = validateKey(keyHex);

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // Do NOT include ciphertext content in the error message
    throw new Error('encryption/decryption error: malformed ciphertext format');
  }

  const [ivB64, authTagB64, dataB64] = parts;

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, keyBuf, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Intentionally generic — do NOT log plaintext or key material
    throw new Error('encryption/decryption error');
  }
}
